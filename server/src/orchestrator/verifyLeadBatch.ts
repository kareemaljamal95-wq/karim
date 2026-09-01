/**
 * Website verification across many saved leads at once.
 *
 * Discovery records what the map knows, which is often a name, a category and a
 * website — and nothing to write to. The business's own site usually publishes
 * the address the map is missing, but the only way to collect it was one lead
 * at a time, one click each. A database of fifty leads with a handful of
 * contacts stays a database of a handful of contacts.
 *
 * This runs the same single-lead verification over a selection, so an operator
 * turns unreachable leads into reachable ones in one action.
 *
 * It is a read-only errand as far as the outside world is concerned: it fetches
 * public pages and updates the leads' own analysis. It cannot contact anyone.
 */
import { verifyLeadWebsite } from './verifyLead';
import { listLeads, type Lead } from '../services/leads';
import { websiteInspectionAvailable } from '../tools/webEnrichment';
import { failedDependency } from '../util/errors';
import { log } from '../services/logger';

/** Kept level with the workflow's own inspection step, to be a polite visitor. */
const CONCURRENCY = 4;

export interface BatchVerificationResult {
  /** Leads that had a website worth visiting. */
  candidates: number;
  inspected: number;
  /** Leads that gained an email address they did not have before. */
  emailsFound: number;
  /** Leads whose opportunity score moved once the site was read. */
  rescored: number;
  failures: { lead: string; reason: string }[];
  contacts: { lead: string; email: string }[];
}

export interface BatchVerificationInput {
  /** Only visit leads with no email on record. The default: the point is reach. */
  missingContactOnly?: boolean;
  /** Cap the run, so a first attempt can be small. */
  limit?: number;
}

/** Leads worth visiting: live, with a website, and short of what we came for. */
function candidatesFor(input: BatchVerificationInput): Lead[] {
  const missingContactOnly = input.missingContactOnly ?? true;
  return listLeads({ liveOnly: true, limit: 500 })
    .items.filter((lead) => lead.website && !lead.isDemo)
    .filter((lead) => (missingContactOnly ? !lead.email : true))
    .slice(0, Math.min(input.limit ?? 25, 100));
}

export async function verifyLeadWebsites(
  input: BatchVerificationInput,
  actor: string,
): Promise<BatchVerificationResult> {
  if (!websiteInspectionAvailable()) {
    throw failedDependency('Website verification is not enabled. Switch it on in Integrations first.');
  }

  const candidates = candidatesFor(input);
  const result: BatchVerificationResult = {
    candidates: candidates.length,
    inspected: 0,
    emailsFound: 0,
    rescored: 0,
    failures: [],
    contacts: [],
  };

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (lead) => {
        try {
          const verification = await verifyLeadWebsite(lead.id, actor);
          result.inspected += 1;
          if (verification.scoreBefore !== verification.scoreAfter) result.rescored += 1;
          if (!lead.email && verification.lead.email) {
            result.emailsFound += 1;
            result.contacts.push({ lead: lead.businessName, email: verification.lead.email });
          }
        } catch (error) {
          // One unreachable site must not end the run — the next lead's site is
          // usually fine, and a failure here is a fact about that one business.
          result.failures.push({
            lead: lead.businessName,
            reason: error instanceof Error ? error.message : 'verification failed',
          });
        }
      }),
    );
  }

  log({
    actorType: 'user',
    actor,
    action: 'leads.verified_batch',
    message:
      `Checked ${result.inspected} of ${result.candidates} website(s): ` +
      `${result.emailsFound} new email address(es), ${result.rescored} re-scored`,
    meta: { failures: result.failures.length },
  });

  return result;
}
