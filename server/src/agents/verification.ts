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
/**
 * Folds the spelling variants of a phrase onto one form before it is matched.
 *
 * Arabic is written with several interchangeable spellings of the same word:
 * `أضمن`, `اضمن` and `آضمن` differ only in the hamza, optional vowel marks sit
 * on top of any letter, and `ـ` can be inserted anywhere to stretch a word.
 * Matching the raw string means the guards catch one spelling and miss the
 * others — which is not a guard at all, since the miss is what gets sent.
 *
 * Also maps Arabic-Indic digits and `٪`, so a price or a percentage claim is
 * caught in either numeral system.
 */
export function normalize(text: string): string {
  return text
    .replace(/[ً-ْٰـ]/g, '') // vowel marks, dagger alef, tatweel
    .replace(/[آأإٱ]/g, 'ا') // آ إ أ ٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ٠-٩ -> 0-9
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // ۰-۹ -> 0-9
    .replace(/٪/g, '%')
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .toLowerCase();
}

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
  // Arabic, written in the normalised form the matcher sees. Most of the
  // pipeline is Riyadh and Dubai, so an English-only list guards the smaller
  // half of the outreach.
  'الي من يهمه الامر', // to whom it may concern
  'عرض لفتره محدوده', // limited time offer
  'لفتره محدوده فقط', // for a limited time only
  'اشتر الان', // buy now
  'اضغط هنا', // click here
  'سارع الان', // act now
  'فرصه لا تعوض', // an opportunity not to be missed
  'نتايج مضمونه', // guaranteed results (with ئ folded)
  'نتائج مضمونه',
  'مضمون 100%',
  '100% مضمون',
  'نحن الافضل', // we are the best
  'افضل سعر في السوق', // best price on the market
  'هذه ليست رساله مزعجه', // this is not spam
  'تهانينا لقد تم اختيارك', // congratulations, you have been selected
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

  // Arabic. Written against the normalised text, so no hamza or vowel-mark
  // variants are needed here. `\b` is not used: it is meaningless beside Arabic
  // script, where it would match at every letter boundary.
  {
    pattern: /(نضمن|اضمن|نضمن لك|ضمان|مضمون|نتعهد)/,
    reason: 'Guarantees are a commercial commitment and need a human.',
  },
  {
    pattern: /(?:ر\.?س|د\.?[إا]|ج\.?م)\s?\d|\d[\d,.]*\s?(?:ريال|ريالا|درهم|درهما|دولار|دولارا|يورو|جنيه|جنيها|الف|مليون)/,
    reason: 'Concrete prices must not be quoted without approval.',
  },
  {
    pattern: /(?:السعر|التكلفه|التكاليف|الرسوم|الميزانيه)\s*[:هي]*\s*\d/,
    reason: 'Concrete prices must not be quoted without approval.',
  },
  {
    pattern: /\d+\s?%\s?(زياده|نمو|ارباح|مبيعات|عايد|عائد|حجوزات)|(زياده|نمو|ارباح|مبيعات|حجوزات)\s?(?:ب|تصل الي)?\s?\d+\s?%/,
    reason: 'Quantified outcome claims are unverifiable.',
  },
  {
    pattern: /(ضاعف|نضاعف|مضاعفه)\s?(ارباحك|مبيعاتك|دخلك|عملاءك)/,
    reason: 'Outcome promises are unverifiable.',
  },
  {
    pattern: /(استرداد|استرجاع)\s?(المبلغ|النقود|الاموال|كامل)/,
    reason: 'Refund terms are a commercial commitment.',
  },
  {
    pattern: /مجان(?:ي|ا|ية)?\s?(?:للابد|مدي الحياه|الي الابد)/,
    reason: 'Open-ended commercial commitment.',
  },
];

/** Language implying the sender is a human being. */
export const HUMAN_IMPERSONATION_PATTERNS: RegExp[] = [
  /\bi (walked|drove|visited|stopped by|ate|dined|had lunch|had dinner) (past |at |in )?your\b/i,
  /\bi'?m a (real |)human\b/i,
  /\bi live (nearby|near you|in the area)\b/i,
  /\bmy (wife|husband|family|kids|colleague) (and i |)(visited|went|ate)\b/i,
  /\bwhen i was (there|in your shop|at your)\b/i,

  // Arabic, against the normalised text.
  /(زرت|زرنا)\s?(محلك|متجرك|مقهاك|مطعمك|فرعك)/,
  /مررت\s?(بمحلك|بمتجرك|امام)/,
  /انا\s?(انسان|بشر|شخص حقيقي)/,
  /(اسكن|اعيش)\s?(قريبا|بالقرب منك|في المنطقه|في نفس الحي)/,
  /(تناولت|شربت)\s?(الغداء|العشاء|القهوه|الفطور)\s?(عندكم|لديكم|في محلكم)/,
];

/**
 * Every guard reads the normalised text, so a phrase spelled with a different
 * hamza, a vowel mark or Arabic-Indic digits is caught like the plain form.
 * The normalised phrase is what gets reported — it is what matched.
 */
export function findSpamPhrases(text: string): string[] {
  const haystack = normalize(text);
  return SPAM_PHRASES.filter((phrase) => haystack.includes(phrase));
}

export function findForbiddenClaims(text: string): { phrase: string; reason: string }[] {
  const haystack = normalize(text);
  const found: { phrase: string; reason: string }[] = [];
  for (const { pattern, reason } of FORBIDDEN_CLAIM_PATTERNS) {
    const match = haystack.match(pattern);
    if (match) found.push({ phrase: match[0], reason });
  }
  return found;
}

export function findImpersonation(text: string): string[] {
  const haystack = normalize(text);
  return HUMAN_IMPERSONATION_PATTERNS.map((p) => haystack.match(p)?.[0]).filter(
    (m): m is string => Boolean(m),
  );
}
