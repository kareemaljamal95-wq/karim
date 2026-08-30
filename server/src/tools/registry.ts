import { generateDemoBusinesses, DEMO_NOTICE } from './demoData';
import { googlePlacesAvailable, searchGooglePlaces } from './googlePlaces';
import { openStreetMapAvailable, searchOpenStreetMap } from './openStreetMap';
import { isActive } from '../services/integrations';
import { log } from '../services/logger';
import type { DiscoveredBusiness } from '../domain/business';

export interface ToolDescriptor {
  key: string;
  name: string;
  description: string;
  /** Integration that must be connected for the tool to run live. */
  requires: string | null;
  available: boolean;
  /** Whether the tool falls back to demo output when unavailable. */
  hasDemoFallback: boolean;
}

/**
 * The tool layer agents are allowed to reach for. Keeping this list explicit
 * means an agent's `tools` configuration can be validated against reality, and
 * the Agent Control Center can show exactly which capabilities are live.
 */
export function listTools(): ToolDescriptor[] {
  return [
    {
      key: 'business_discovery',
      name: 'Business discovery',
      description:
        'Finds businesses by country, city, area and category. Uses Google Places when connected, OpenStreetMap otherwise.',
      requires: googlePlacesAvailable() ? 'google_places' : 'open_street_map',
      available: googlePlacesAvailable() || openStreetMapAvailable(),
      hasDemoFallback: true,
    },
    {
      key: 'llm_reasoning',
      name: 'LLM reasoning',
      description: 'Claude-powered analysis and copywriting.',
      requires: 'anthropic',
      available: isActive('anthropic'),
      hasDemoFallback: true,
    },
    {
      key: 'email_send',
      name: 'Email delivery',
      description: 'Sends an approved message over email.',
      requires: 'gmail',
      available: isActive('gmail'),
      hasDemoFallback: false,
    },
    {
      key: 'whatsapp_send',
      name: 'WhatsApp delivery',
      description: 'Sends an approved message over WhatsApp Business.',
      requires: 'whatsapp_business',
      available: isActive('whatsapp_business'),
      hasDemoFallback: false,
    },
    {
      key: 'crm_sync',
      name: 'CRM sync',
      description: 'Pushes leads and stage changes to an external CRM.',
      requires: 'crm',
      available: isActive('crm'),
      hasDemoFallback: false,
    },
    {
      key: 'webhook_notify',
      name: 'Webhook notification',
      description: 'Notifies an external endpoint about platform events.',
      requires: 'webhooks',
      available: isActive('webhooks'),
      hasDemoFallback: false,
    },
  ];
}

export type DiscoverySource = 'google_places' | 'openstreetmap' | 'demo';

export interface DiscoveryResult {
  businesses: DiscoveredBusiness[];
  source: DiscoverySource;
  demo: boolean;
  query: string;
  notice: string | null;
  /** Set when a live search was attempted and failed. */
  degradedReason: string | null;
}

export interface DiscoveryParams {
  country: string;
  city: string;
  area?: string;
  category: string;
  limit?: number;
  runId?: string | null;
}

/** Live sources in preference order, filtered to the ones actually connected. */
function liveSources(): {
  key: Exclude<DiscoverySource, 'demo'>;
  search: (
    params: DiscoveryParams,
  ) => Promise<{ businesses: DiscoveredBusiness[]; query: string; notice?: string | null }>;
}[] {
  return [
    { key: 'google_places' as const, available: googlePlacesAvailable(), search: searchGooglePlaces },
    { key: 'openstreetmap' as const, available: openStreetMapAvailable(), search: searchOpenStreetMap },
  ]
    .filter((source) => source.available)
    .map(({ key, search }) => ({ key, search }));
}

/**
 * Discovery entry point used by the Market Scout.
 *
 * Live data is preferred whenever a discovery integration is connected, Google
 * Places first and OpenStreetMap second. If a source fails the next one is
 * tried, and if none succeeds the platform returns clearly-labelled demo data
 * rather than failing the run — recording why in the audit log either way.
 */
export async function discoverBusinesses(params: DiscoveryParams): Promise<DiscoveryResult> {
  const locationParts = [params.area, params.city, params.country].filter(Boolean).join(', ');
  const query = `${params.category} in ${locationParts}`;
  let lastFailure: string | null = null;

  for (const source of liveSources()) {
    try {
      const live = await source.search(params);
      return {
        businesses: live.businesses,
        source: source.key,
        demo: false,
        query: live.query,
        notice: live.notice ?? null,
        degradedReason: lastFailure,
      };
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'Unknown discovery error';
      log({
        level: 'warn',
        actorType: 'agent',
        actor: 'market_scout',
        action: 'discovery.fallback',
        runId: params.runId ?? null,
        message: `Discovery via ${source.key} failed: ${lastFailure}`,
        meta: { query, source: source.key },
      });
    }
  }

  return {
    businesses: generateDemoBusinesses(params),
    source: 'demo',
    demo: true,
    query,
    notice: DEMO_NOTICE,
    degradedReason: lastFailure,
  };
}
