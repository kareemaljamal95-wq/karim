import { complete } from '../llm/provider';
import { scoreLead, type LeadScoreResult, type OpportunityAssessment } from '../domain/scoring';
import type { ServiceMatch } from '../domain/services';
import type { DiscoveredBusiness } from '../domain/business';
import type { Signal } from '../types';
import { Verifier } from './verification';
import { getAgent } from './registry';
import { outcome, RULE_ENGINE_NOTE, type AgentOutcome, type AgentRunContext } from './types';

export interface LeadScoringResult extends LeadScoreResult {
  /** Short human explanation of the grade and what would improve it. */
  explanation: string;
  nextAction: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
    nextAction: { type: 'string' },
  },
  required: ['explanation', 'nextAction'],
  additionalProperties: false,
};

/**
 * Lead Scoring Agent.
 *
 * The score, breakdown and grade are deterministic. The model is only allowed
 * to explain them — a verification check rejects any explanation that contradicts
 * the computed grade.
 */
export async function runLeadScorer(
  business: DiscoveredBusiness,
  signals: Signal[],
  opportunity: OpportunityAssessment,
  topMatch: ServiceMatch | null,
  estimatedValue: number,
  ctx: AgentRunContext = {},
): Promise<AgentOutcome<LeadScoringResult>> {
  const config = getAgent('lead_scorer');
  const scored = scoreLead(business, signals, opportunity, topMatch, estimatedValue);

  let explanation = scored.justification;
  let nextAction = defaultNextAction(scored, business);
  let usedLlm = false;
  const notes: string[] = [];

  if (config.enabled) {
    const response = await complete<{ explanation: string; nextAction: string }>({
      purpose: 'lead_scoring_explanation',
      runId: ctx.runId,
      system: config.systemPrompt,
      maxTokens: 1200,
      schema: SCHEMA,
      prompt: [
        `Business: ${business.name} (${business.category}, ${business.city}).`,
        `Computed score: ${scored.score}/100. Grade: ${scored.grade}. Do not change these numbers.`,
        '',
        'Sub-scores (0-100):',
        JSON.stringify(scored.breakdown, null, 2),
        '',
        scored.caveats.length ? `Caveats: ${scored.caveats.join(' ')}` : 'No caveats.',
        '',
        `Recommended service: ${topMatch?.service.label ?? 'none evidenced'}.`,
        '',
        'Write `explanation` (2-3 sentences: why this grade, and what single factor would raise it) and `nextAction` (the one concrete next step for this lead).',
      ].join('\n'),
      parse: (raw) => {
        const value = raw as { explanation?: string; nextAction?: string };
        if (!value.explanation || !value.nextAction) throw new Error('Missing explanation fields');
        return { explanation: String(value.explanation), nextAction: String(value.nextAction) };
      },
    });

    if (response.ok) {
      explanation = response.data.explanation;
      nextAction = response.data.nextAction;
      usedLlm = true;
      notes.push(`Explanation written by ${response.model}.`);
    } else {
      notes.push(`${RULE_ENGINE_NOTE} (${response.message})`);
    }
  }

  const result: LeadScoringResult = { ...scored, explanation, nextAction };

  const expectedGrade = scored.score >= 75 ? 'A' : scored.score >= 55 ? 'B' : 'C';
  const verifier = new Verifier()
    .require('score_in_range', scored.score >= 0 && scored.score <= 100, 'Score is within 0-100.')
    .require(
      'grade_matches_score',
      scored.grade === expectedGrade,
      `Grade ${scored.grade} matches the score band for ${scored.score}.`,
    )
    .require(
      'all_dimensions_scored',
      Object.values(scored.breakdown).every((v) => typeof v === 'number' && v >= 0 && v <= 100),
      'All seven scoring dimensions produced a value in range.',
    )
    .require(
      'score_is_justified',
      result.explanation.trim().length >= 20,
      'The score carries a written justification.',
    )
    .expect(
      'explanation_consistent_with_grade',
      !contradictsGrade(result.explanation, scored.grade),
      'The written explanation does not contradict the computed grade.',
    )
    .expect(
      'contactable',
      scored.breakdown.contactQuality > 0,
      scored.breakdown.contactQuality > 0
        ? 'The lead has at least one usable contact channel.'
        : 'No usable contact channel — outreach cannot be delivered.',
    );

  for (const caveat of scored.caveats) verifier.warn(caveat);

  return outcome('lead_scorer', result, verifier.report(), usedLlm, notes);
}

function contradictsGrade(explanation: string, grade: string): boolean {
  const text = explanation.toLowerCase();
  const claimsA = /\bgrade a\b|\ba-grade\b|\btop tier\b/.test(text);
  const claimsC = /\bgrade c\b|\bc-grade\b|\blow priority\b/.test(text);
  if (grade !== 'A' && claimsA) return true;
  if (grade !== 'C' && claimsC) return true;
  return false;
}

function defaultNextAction(scored: LeadScoreResult, business: DiscoveredBusiness): string {
  if (scored.breakdown.contactQuality === 0) {
    return `Find a public contact channel for ${business.name} before any outreach.`;
  }
  if (scored.grade === 'A') return 'Generate a personalised first message and send it for approval.';
  if (scored.grade === 'B') return 'Verify the opportunity signals, then draft outreach.';
  return 'Keep in the database; revisit if better evidence appears.';
}
