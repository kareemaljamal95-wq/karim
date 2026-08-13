import type { LeadGrade, Signal } from '../types';
import { isPlausibleEmail, type DiscoveredBusiness } from './business';
import { hasSignal, signalPressure } from './signals';
import type { ServiceMatch } from './services';

export interface OpportunityAssessment {
  score: number;
  confidence: number;
  drivers: { label: string; contribution: number }[];
}

/**
 * Opportunity score (0-100): how much of a real, addressable digital gap exists.
 *
 * Deliberately deterministic. The LLM writes the narrative around this number,
 * but the number itself is reproducible and traceable to the evidence — which
 * is what lets the platform justify every score it shows.
 */
export function scoreOpportunity(
  business: DiscoveredBusiness,
  signals: Signal[],
): OpportunityAssessment {
  const gap = signalPressure(signals); // 0..1 — size of the digital gap
  const reviews = business.reviewCount ?? 0;
  const rating = business.rating ?? 0;

  // Demand: an opportunity is only valuable if customers are actually there.
  const demand = Math.min(1, Math.log10(Math.max(reviews, 1) + 1) / Math.log10(501));
  // Quality: well-run businesses with a gap convert better than failing ones.
  const quality = rating > 0 ? Math.min(1, Math.max(0, (rating - 3) / 1.8)) : 0.45;

  const raw = gap * 62 + demand * 25 + quality * 13;

  // Confidence reflects how much evidence we actually have, not how big the score is.
  const evidenceCount = signals.length;
  const avgConfidence = evidenceCount
    ? signals.reduce((s, x) => s + x.confidence, 0) / evidenceCount
    : 0.3;
  const dataCompleteness =
    [business.website, business.phone, business.rating, business.reviewCount, business.openingHours].filter(
      (v) => v !== null && v !== undefined && v !== '',
    ).length / 5;
  const confidence = Number(Math.min(0.98, avgConfidence * 0.65 + dataCompleteness * 0.35).toFixed(2));

  const drivers = [
    { label: 'Observed digital gaps', contribution: Math.round(gap * 62) },
    { label: 'Customer demand', contribution: Math.round(demand * 25) },
    { label: 'Business quality', contribution: Math.round(quality * 13) },
  ];

  return { score: Math.round(Math.min(100, Math.max(0, raw))), confidence, drivers };
}

export interface LeadScoreBreakdown {
  businessNeed: number;
  abilityToPay: number;
  digitalGap: number;
  potentialValue: number;
  likelihoodOfResponding: number;
  likelihoodOfBuying: number;
  contactQuality: number;
}

export interface LeadScoreResult {
  score: number;
  grade: LeadGrade;
  breakdown: LeadScoreBreakdown;
  justification: string;
  /** Reasons the lead was capped or downgraded — surfaced in the UI. */
  caveats: string[];
}

/** 0-100 sub-score helpers. */
const pct = (value: number): number => Math.round(Math.min(100, Math.max(0, value)));

/**
 * Lead score (0-100) across the seven dimensions in the brief, then A/B/C.
 *
 * Contact quality is a hard gate: a lead we cannot reach is not an A, no matter
 * how attractive the opportunity looks.
 */
export function scoreLead(
  business: DiscoveredBusiness,
  signals: Signal[],
  opportunity: OpportunityAssessment,
  topMatch: ServiceMatch | null,
  estimatedValue: number,
): LeadScoreResult {
  const reviews = business.reviewCount ?? 0;
  const rating = business.rating ?? 0;
  const priceLevel = business.observations?.priceLevel ?? 2;
  const caveats: string[] = [];

  const businessNeed = pct(opportunity.score);
  const digitalGap = pct(signalPressure(signals) * 100);

  // Ability to pay: throughput proxy (reviews) + price positioning + rating.
  const abilityToPay = pct(
    Math.min(1, Math.log10(Math.max(reviews, 1) + 1) / Math.log10(401)) * 55 +
      ((Math.min(Math.max(priceLevel, 1), 4) - 1) / 3) * 30 +
      (rating > 0 ? Math.min(1, rating / 5) * 15 : 7),
  );

  // Potential value relative to a 15k reference deal.
  const potentialValue = pct((estimatedValue / 15000) * 100);

  // Contactability.
  const hasPhone = Boolean(business.phone);
  const hasEmail = isPlausibleEmail(business.email);
  const hasSocial = Object.values(business.socialLinks ?? {}).filter(Boolean).length > 0;
  const contactQuality = pct((hasEmail ? 55 : 0) + (hasPhone ? 35 : 0) + (hasSocial ? 10 : 0));
  if (!hasEmail && !hasPhone) {
    caveats.push('No direct contact channel is published, so outreach cannot be personalised or delivered.');
  } else if (!hasEmail) {
    caveats.push('No public email — outreach depends on phone or social channels.');
  }

  // Likelihood of responding: reachable + active + not already saturated.
  const likelihoodOfResponding = pct(
    contactQuality * 0.55 +
      (hasSignal(signals, 'high_customer_activity') ? 20 : 8) +
      (hasSignal(signals, 'no_website') ? 12 : 6) +
      (rating >= 4.2 ? 10 : 4),
  );

  // Likelihood of buying: clear, evidenced, category-relevant gap.
  const evidenceStrength = topMatch ? Math.min(1, topMatch.score / 60) : 0;
  const likelihoodOfBuying = pct(
    evidenceStrength * 45 + (businessNeed / 100) * 30 + (abilityToPay / 100) * 25,
  );
  if (!topMatch) {
    caveats.push('No service could be justified from the observed evidence.');
  }

  const breakdown: LeadScoreBreakdown = {
    businessNeed,
    abilityToPay,
    digitalGap,
    potentialValue,
    likelihoodOfResponding,
    likelihoodOfBuying,
    contactQuality,
  };

  const weighted =
    businessNeed * 0.2 +
    abilityToPay * 0.15 +
    digitalGap * 0.15 +
    potentialValue * 0.1 +
    likelihoodOfResponding * 0.15 +
    likelihoodOfBuying * 0.15 +
    contactQuality * 0.1;

  let score = Math.round(weighted);

  // Confidence gate: thin evidence must not produce a confident score.
  if (opportunity.confidence < 0.5) {
    score = Math.min(score, 64);
    caveats.push('Public data was incomplete, so the score is capped until the lead is researched further.');
  }
  // Unreachable leads are capped out of grade A regardless of fit.
  if (contactQuality === 0) {
    score = Math.min(score, 45);
  }

  const grade: LeadGrade = score >= 75 ? 'A' : score >= 55 ? 'B' : 'C';

  const justification =
    `Scored ${score}/100 (grade ${grade}). Need ${businessNeed}, digital gap ${digitalGap}, ` +
    `ability to pay ${abilityToPay}, response likelihood ${likelihoodOfResponding}, ` +
    `buying likelihood ${likelihoodOfBuying}, contact quality ${contactQuality}.`;

  return { score, grade, breakdown, justification, caveats };
}
