/**
 * On-demand verification of a single saved lead.
 *
 * The discovery sources describe a business from the outside; only its own
 * website shows how it actually serves customers. This visits that site, folds
 * what was found into the lead's observations, and re-runs the same analyst,
 * strategist and scorer the pipeline uses — so a verified lead is scored on
 * evidence rather than on absence.
 *
 * A lead with no website is refused rather than guessed at.
 */
import { runOpportunityAnalyst } from '../agents/opportunityAnalyst';
import { runServiceStrategist } from '../agents/serviceStrategist';
import { runLeadScorer } from '../agents/leadScorer';
import { inspectWebsite, websiteInspectionAvailable, type InspectionResult } from '../tools/webEnrichment';
import { getLead, writeAnalysis, type Lead } from '../services/leads';
import { badRequest, failedDependency } from '../util/errors';
import { log } from '../services/logger';
import type { DiscoveredBusiness, DiscoverySourceName } from '../domain/business';

export interface LeadVerification {
  lead: Lead;
  inspection: InspectionResult;
  scoreBefore: number | null;
  scoreAfter: number | null;
}

/** Rebuilds the discovered-business view of a stored lead. */
function businessOf(lead: Lead): DiscoveredBusiness {
  return {
    name: lead.businessName,
    category: lead.category,
    country: lead.country,
    city: lead.city,
    area: lead.area,
    address: lead.address,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    mapsUrl: lead.mapsUrl,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    openingHours: lead.openingHours,
    socialLinks: lead.socialLinks,
    observations: {},
    source: lead.source as DiscoverySourceName,
    isDemo: lead.isDemo,
  };
}

export async function verifyLeadWebsite(leadId: string, actor: string): Promise<LeadVerification> {
  const lead = getLead(leadId);
  if (!websiteInspectionAvailable()) {
    throw failedDependency('Website verification is not enabled. Switch it on in Integrations first.');
  }
  if (!lead.website) {
    throw badRequest(
      'This lead has no website on record, so there is nothing to verify. That is an unknown, not a gap.',
    );
  }
  if (lead.isDemo) {
    // A demo record's website is fictional. Fetching it would prove only that
    // the sample domain does not exist, and would then score the lead down for
    // it — a fabricated finding about a fabricated business.
    throw badRequest('This is a demo record, so its website is fictional and there is nothing to verify.');
  }

  const business = businessOf(lead);
  const inspection = await inspectWebsite(lead.website);

  business.observations = { ...business.observations, ...inspection.observations };
  business.socialLinks = { ...inspection.socialLinks, ...business.socialLinks };
  if (!business.email && inspection.email) business.email = inspection.email;

  const opportunity = await runOpportunityAnalyst(business, { actor });
  const strategy = await runServiceStrategist(business, opportunity.data.candidateServices, { actor });
  const scoring = await runLeadScorer(
    business,
    opportunity.data.signals,
    {
      score: opportunity.data.score,
      confidence: opportunity.data.confidence,
      drivers: opportunity.data.drivers,
    },
    opportunity.data.candidateServices[0] ?? null,
    strategy.data.estimatedValue || opportunity.data.estimatedValue,
    { actor },
  );

  writeAnalysis(lead.id, business, {
    opportunityScore: opportunity.data.score,
    confidence: opportunity.data.confidence,
    signals: opportunity.data.signals,
    problem: opportunity.data.problem,
    reason: strategy.data.reason || opportunity.data.summary,
    recommendedService: strategy.data.recommendedService,
    estimatedValue: strategy.data.estimatedValue || opportunity.data.estimatedValue,
    leadScore: scoring.data.score,
    leadGrade: scoring.data.grade,
    scoreBreakdown: { ...scoring.data.breakdown, caveats: scoring.data.caveats },
    nextAction: scoring.data.nextAction,
  });

  log({
    actorType: 'user',
    actor,
    action: 'lead.verified',
    entityType: 'lead',
    entityId: lead.id,
    message: inspection.failure
      ? `Website check on ${lead.businessName}: ${inspection.failure}`
      : `Website check on ${lead.businessName}: ${inspection.pagesRead} page(s) read, opportunity ${lead.opportunityScore ?? '—'} → ${opportunity.data.score}`,
    meta: { evidence: inspection.evidence, observations: inspection.observations },
  });

  return {
    lead: getLead(lead.id),
    inspection,
    scoreBefore: lead.opportunityScore,
    scoreAfter: opportunity.data.score,
  };
}
