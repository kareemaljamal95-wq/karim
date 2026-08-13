/**
 * Self-verification primitives.
 *
 * Every agent runs its own output through a set of named checks before the
 * orchestrator will accept it. A failed *blocking* check causes the step to be
 * retried or failed; warnings are surfaced but do not stop the pipeline.
 */

export interface VerificationCheck {
  name: string;
  passed: boolean;
  blocking: boolean;
  detail: string;
}

export interface ValidationReport {
  passed: boolean;
  checks: VerificationCheck[];
  warnings: string[];
}

export class Verifier {
  private checks: VerificationCheck[] = [];
  private warnings: string[] = [];

  /** A check that must pass for the output to be usable. */
  require(name: string, passed: boolean, detail: string): this {
    this.checks.push({ name, passed, blocking: true, detail });
    return this;
  }

  /** A check that is recorded but does not block the pipeline. */
  expect(name: string, passed: boolean, detail: string): this {
    this.checks.push({ name, passed, blocking: false, detail });
    if (!passed) this.warnings.push(`${name}: ${detail}`);
    return this;
  }

  warn(message: string): this {
    this.warnings.push(message);
    return this;
  }

  report(): ValidationReport {
    const passed = this.checks.every((c) => !c.blocking || c.passed);
    return { passed, checks: this.checks, warnings: this.warnings };
  }
}

export const failedChecks = (report: ValidationReport): VerificationCheck[] =>
  report.checks.filter((c) => c.blocking && !c.passed);

/** Phrases that mark generic outreach spam. Used by the message quality check. */
export const SPAM_PHRASES = [
  'dear sir/madam',
  'dear sir or madam',
  'to whom it may concern',
  'act now',
  'limited time offer',
  'risk free',
  'guaranteed results',
  '100% guaranteed',
  'best price in the market',
  'we are the best',
  'buy now',
  'click here now',
  'this is not spam',
  'congratulations, you have been selected',
];

/**
 * Claims an AI agent must never make on its own authority.
 *
 * Note on the currency patterns: a `\b` before `$` never matches (there is no
 * word boundary between a space and a symbol), so symbols are matched directly
 * and only the alphabetic currency codes carry a boundary. Both orders —
 * "$500" and "500 USD" — have to be covered.
 */
export const FORBIDDEN_CLAIM_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bguarantee(d|s|ing)?\b/i, reason: 'Guarantees are a commercial commitment and need a human.' },
  {
    pattern: /(?:[$£€]|\b(?:usd|aed|sar|qar|eur|gbp|egp)\b)\s?\d/i,
    reason: 'Concrete prices must not be quoted without approval.',
  },
  {
    pattern: /\d[\d,.]*\s?(?:usd|aed|sar|qar|eur|gbp|egp|dollars?|dirhams?|riyals?|pounds?)\b/i,
    reason: 'Concrete prices must not be quoted without approval.',
  },
  {
    pattern: /\b\d+\s?%\s?(more|increase|growth|revenue|roi|sales|bookings)\b/i,
    reason: 'Quantified outcome claims are unverifiable.',
  },
  { pattern: /\b(double|triple|10x)\s+your\b/i, reason: 'Outcome promises are unverifiable.' },
  { pattern: /\bfree of charge forever\b/i, reason: 'Open-ended commercial commitment.' },
  { pattern: /\brefunds?\b/i, reason: 'Refund terms are a commercial commitment.' },
  { pattern: /\bmoney[- ]back\b/i, reason: 'Money-back terms are a commercial commitment.' },
];

/** Language implying the sender is a human being. */
export const HUMAN_IMPERSONATION_PATTERNS: RegExp[] = [
  /\bi (walked|drove|visited|stopped by|ate|dined|had lunch|had dinner) (past |at |in )?your\b/i,
  /\bi'?m a (real |)human\b/i,
  /\bi live (nearby|near you|in the area)\b/i,
  /\bmy (wife|husband|family|kids|colleague) (and i |)(visited|went|ate)\b/i,
  /\bwhen i was (there|in your shop|at your)\b/i,
];

export function findSpamPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return SPAM_PHRASES.filter((phrase) => lower.includes(phrase));
}

export function findForbiddenClaims(text: string): { phrase: string; reason: string }[] {
  const found: { phrase: string; reason: string }[] = [];
  for (const { pattern, reason } of FORBIDDEN_CLAIM_PATTERNS) {
    const match = text.match(pattern);
    if (match) found.push({ phrase: match[0], reason });
  }
  return found;
}

export function findImpersonation(text: string): string[] {
  return HUMAN_IMPERSONATION_PATTERNS.map((p) => text.match(p)?.[0]).filter(
    (m): m is string => Boolean(m),
  );
}
