import { discoverBusinesses } from '../tools/registry';
import { dedupeKey, isPlausibleEmail, type DiscoveredBusiness } from '../domain/business';
import { db } from '../db';
import { Verifier } from './verification';
import { outcome, type AgentOutcome, type AgentRunContext } from './types';
import { getAgent } from './registry';

export interface ScoutInput {
  country: string;
  city: string;
  area?: string;
  category: string;
  limit?: number;
}

export interface ScoutResult {
  businesses: DiscoveredBusiness[];
  source: 'google_places' | 'demo';
  demo: boolean;
  query: string;
  notice: string | null;
  degradedReason: string | null;
  stats: {
    discovered: number;
    duplicatesInBatch: number;
    alreadyInDatabase: number;
    usable: number;
  };
}

/**
 * Market Scout.
 *
 * Discovers businesses, normalises them and removes duplicates both within the
 * batch and against the existing lead database. It only ever passes through
 * fields the source actually returned — in particular it never derives an email
 * address from a website domain.
 */
export async function runMarketScout(
  input: ScoutInput,
  ctx: AgentRunContext = {},
): Promise<AgentOutcome<ScoutResult>> {
  const config = getAgent('market_scout');
  const limit = Math.min(input.limit ?? 12, config.maxActions);

  const discovery = await discoverBusinesses({
    country: input.country,
    city: input.city,
    area: input.area,
    category: input.category,
    limit,
    runId: ctx.runId,
  });

  const seen = new Set<string>();
  const unique: DiscoveredBusiness[] = [];
  let duplicatesInBatch = 0;

  for (const business of discovery.businesses) {
    const key = dedupeKey(business);
    if (seen.has(key)) {
      duplicatesInBatch += 1;
      continue;
    }
    seen.add(key);
    unique.push(normalise(business));
  }

  // Duplicates against the existing database are reported, not dropped — the
  // import step decides whether to skip or refresh them.
  const existing = db().prepare('SELECT dedupe_key FROM leads').all() as { dedupe_key: string }[];
  const existingKeys = new Set(existing.map((r) => r.dedupe_key));
  const alreadyInDatabase = unique.filter((b) => existingKeys.has(dedupeKey(b))).length;

  const verifier = new Verifier()
    .require(
      'required_fields_present',
      unique.every((b) => Boolean(b.name && b.category && b.city)),
      'Every discovered business has a name, category and city.',
    )
    .require(
      'no_fabricated_emails',
      unique.every((b) => b.email === null || isPlausibleEmail(b.email)),
      'No malformed or invented email addresses were produced.',
    )
    .require(
      'no_duplicates_in_output',
      new Set(unique.map(dedupeKey)).size === unique.length,
      'The returned batch contains no duplicate businesses.',
    )
    .expect(
      'live_source_used',
      discovery.source === 'google_places',
      discovery.source === 'google_places'
        ? 'Results came from the live Google Places integration.'
        : 'Results are clearly-labelled demo data because no live discovery integration is connected.',
    )
    .expect(
      'results_found',
      unique.length > 0,
      unique.length > 0 ? `${unique.length} businesses discovered.` : 'The search returned no businesses.',
    );

  if (discovery.degradedReason) {
    verifier.warn(`Live discovery failed and fell back to demo data: ${discovery.degradedReason}`);
  }

  const result: ScoutResult = {
    businesses: unique,
    source: discovery.source,
    demo: discovery.demo,
    query: discovery.query,
    notice: discovery.notice,
    degradedReason: discovery.degradedReason,
    stats: {
      discovered: discovery.businesses.length,
      duplicatesInBatch,
      alreadyInDatabase,
      usable: unique.length,
    },
  };

  return outcome('market_scout', result, verifier.report(), false, [
    `Query: ${discovery.query}`,
    `Source: ${discovery.source}`,
  ]);
}

/** Trims and canonicalises fields without adding anything that was not present. */
function normalise(business: DiscoveredBusiness): DiscoveredBusiness {
  const trim = (v?: string | null): string | null => {
    const t = v?.trim();
    return t ? t : null;
  };
  return {
    ...business,
    name: business.name.trim(),
    category: business.category.trim(),
    address: trim(business.address),
    phone: trim(business.phone),
    email: isPlausibleEmail(business.email) ? business.email!.trim().toLowerCase() : null,
    website: trim(business.website),
    mapsUrl: trim(business.mapsUrl),
    openingHours: trim(business.openingHours),
    socialLinks: business.socialLinks ?? {},
  };
}
