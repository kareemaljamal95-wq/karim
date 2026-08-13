import { complete } from '../llm/provider';
import { detectSignals } from '../domain/signals';
import { scoreOpportunity, type OpportunityAssessment } from '../domain/scoring';
import { rankServices, summariseProblem, estimateValue, type ServiceMatch } from '../domain/services';
import type { DiscoveredBusiness } from '../domain/business';
import type { ServiceKey, Signal } from '../types';
import { getSettings } from '../services/settings';
import { Verifier } from './verification';
import { getAgent } from './registry';
import { outcome, RULE_ENGINE_NOTE, type AgentOutcome, type AgentRunContext } from './types';

export interface OpportunityResult {
  score: number;
  confidence: number;
  signals: Signal[];
  drivers: { label: string; contribution: number }[];
  /** Why this business is a good (or poor) opportunity. */
  summary: string;
  /** The specific problem that exists today. */
  problem: string;
  /** What kind of service would address it. */
  possibleSolution: string;
  estimatedValue: number;
  candidateServices: ServiceMatch[];
  isOpportunity: boolean;
}

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    problem: { type: 'string' },
    possibleSolution: { type: 'string' },
    evidenceUsed: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'problem', 'possibleSolution', 'evidenceUsed'],
  additionalProperties: false,
};

interface Narrative {
  summary: string;
  problem: string;
  possibleSolution: string;
  evidenceUsed: string[];
}

/**
 * Opportunity Analyst.
 *
 * The score is computed deterministically from observed signals so it is
 * reproducible and auditable; the model only writes the explanation around it.
 * That split is what lets the platform always answer "why this score?".
 */
export async function runOpportunityAnalyst(
  business: DiscoveredBusiness,
  ctx: AgentRunContext = {},
): Promise<AgentOutcome<OpportunityResult>> {
  const config = getAgent('opportunity_analyst');
  const settings = getSettings();

  const signals = detectSignals(business);
  const assessment: OpportunityAssessment = scoreOpportunity(business, signals);
  // An empty `offeredServices` means "the whole catalogue is fair game".
  const candidates = rankServices(business, signals, settings.offeredServices as ServiceKey[]);
  const top = candidates[0] ?? null;
  const estimated = top ? estimateValue(top.service, business) : 0;

  let narrative: Narrative = fallbackNarrative(business, signals, candidates);
  let usedLlm = false;
  const notes: string[] = [];

  if (config.enabled && signals.length > 0) {
    const response = await complete<Narrative>({
      purpose: 'opportunity_analysis',
      runId: ctx.runId,
      system: config.systemPrompt,
      maxTokens: 2000,
      schema: SCHEMA,
      prompt: buildPrompt(business, signals, assessment, candidates),
      parse: (raw) => {
        const value = raw as Partial<Narrative>;
        if (!value.summary || !value.problem || !value.possibleSolution) {
          throw new Error('Missing required narrative fields');
        }
        return {
          summary: String(value.summary),
          problem: String(value.problem),
          possibleSolution: String(value.possibleSolution),
          evidenceUsed: Array.isArray(value.evidenceUsed) ? value.evidenceUsed.map(String) : [],
        };
      },
    });

    if (response.ok) {
      narrative = response.data;
      usedLlm = true;
      notes.push(`Narrative written by ${response.model}.`);
    } else {
      notes.push(`${RULE_ENGINE_NOTE} (${response.message})`);
    }
  } else if (signals.length === 0) {
    notes.push('No opportunity signals were observed, so no narrative was requested.');
  }

  const result: OpportunityResult = {
    score: assessment.score,
    confidence: assessment.confidence,
    signals,
    drivers: assessment.drivers,
    summary: narrative.summary,
    problem: narrative.problem,
    possibleSolution: narrative.possibleSolution,
    estimatedValue: estimated,
    candidateServices: candidates,
    isOpportunity: assessment.score >= 40 && candidates.length > 0,
  };

  const evidenceText = signals.map((s) => s.evidence.toLowerCase()).join(' ');
  const verifier = new Verifier()
    .require('score_in_range', result.score >= 0 && result.score <= 100, 'Score is within 0-100.')
    .require(
      'confidence_in_range',
      result.confidence > 0 && result.confidence <= 1,
      'Confidence is expressed as a 0-1 probability.',
    )
    .require(
      'claims_supported_by_evidence',
      signals.length > 0 || result.score === 0 || !result.isOpportunity,
      'An opportunity is only asserted when at least one signal was observed.',
    )
    .expect(
      'narrative_references_evidence',
      signals.length === 0 || referencesEvidence(narrative, signals, evidenceText),
      'The written explanation refers to observed evidence rather than assumptions.',
    )
    .expect(
      'confidence_matches_evidence',
      !(result.confidence > 0.8 && signals.length < 2),
      'High confidence is only claimed when multiple signals support it.',
    );

  if (!top) {
    verifier.warn('No service in the catalogue is supported by the observed evidence.');
  }
  if (result.confidence < 0.5) {
    verifier.warn('Public data was sparse — this assessment should be re-checked before outreach.');
  }

  return outcome('opportunity_analyst', result, verifier.report(), usedLlm, notes);
}

function buildPrompt(
  business: DiscoveredBusiness,
  signals: Signal[],
  assessment: OpportunityAssessment,
  candidates: ServiceMatch[],
): string {
  return [
    'Business profile (only these facts are known):',
    JSON.stringify(
      {
        name: business.name,
        category: business.category,
        location: [business.area, business.city, business.country].filter(Boolean).join(', '),
        website: business.website ?? 'none listed',
        rating: business.rating ?? 'unknown',
        reviewCount: business.reviewCount ?? 'unknown',
        openingHours: business.openingHours ?? 'unknown',
        hasPublicEmail: Boolean(business.email),
        hasPublicPhone: Boolean(business.phone),
        socialProfiles: Object.keys(business.socialLinks ?? {}),
      },
      null,
      2,
    ),
    '',
    'Observed signals (evidence you may rely on):',
    signals.map((s) => `- ${s.label}: ${s.evidence} (confidence ${s.confidence})`).join('\n'),
    '',
    `Computed opportunity score: ${assessment.score}/100 (confidence ${assessment.confidence}). Do not restate the number; explain it.`,
    '',
    candidates.length
      ? `Service types the evidence could support: ${candidates.map((c) => c.service.label).join(', ')}.`
      : 'No service in the catalogue is clearly supported by this evidence.',
    '',
    'Write: (1) summary — why this is or is not a good opportunity, (2) problem — the specific problem that exists today, (3) possibleSolution — the kind of service that would address it, and (4) evidenceUsed — the exact evidence sentences you relied on.',
  ].join('\n');
}

function referencesEvidence(narrative: Narrative, signals: Signal[], evidenceText: string): boolean {
  if (narrative.evidenceUsed.length > 0) {
    // Each cited item should overlap with real evidence we supplied.
    return narrative.evidenceUsed.some((cited) => {
      const words = cited.toLowerCase().split(/\s+/).filter((w) => w.length > 5);
      return words.some((w) => evidenceText.includes(w));
    });
  }
  const text = `${narrative.summary} ${narrative.problem}`.toLowerCase();
  return signals.some((s) => {
    const keyword = s.label.toLowerCase().split(' ').filter((w) => w.length > 4)[0];
    return keyword ? text.includes(keyword) : false;
  });
}

function fallbackNarrative(
  business: DiscoveredBusiness,
  signals: Signal[],
  candidates: ServiceMatch[],
): Narrative {
  if (!signals.length) {
    return {
      summary: `No digital gap could be observed for ${business.name} from the available public information.`,
      problem: 'No problem could be evidenced from public data.',
      possibleSolution: 'No service is recommended until more is known about this business.',
      evidenceUsed: [],
    };
  }

  const top = candidates[0];
  const strongest = [...signals].sort((a, b) => b.weight * b.confidence - a.weight * a.confidence);
  const headline = strongest.slice(0, 2).map((s) => s.label.toLowerCase()).join(' and ');

  return {
    summary:
      `${business.name} shows ${signals.length} observable gap${signals.length === 1 ? '' : 's'}, most notably ${headline}.` +
      (business.reviewCount
        ? ` With ${business.reviewCount} public reviews, there is existing customer demand behind the gap.`
        : ''),
    problem: summariseProblem(candidates, signals),
    possibleSolution: top
      ? `${top.service.label}: ${top.service.summary}`
      : 'No catalogue service is clearly supported by this evidence.',
    evidenceUsed: strongest.slice(0, 3).map((s) => s.evidence),
  };
}
