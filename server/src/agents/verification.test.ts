import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Verifier, findForbiddenClaims, findImpersonation, findSpamPhrases } from './verification';

describe('Verifier', () => {
  it('fails only when a blocking check fails', () => {
    const blocking = new Verifier().require('must_hold', false, 'detail').report();
    assert.equal(blocking.passed, false);

    const advisory = new Verifier().expect('nice_to_have', false, 'detail').report();
    assert.equal(advisory.passed, true);
    assert.equal(advisory.warnings.length, 1);
  });

  it('passes when every blocking check holds', () => {
    const report = new Verifier()
      .require('a', true, 'ok')
      .require('b', true, 'ok')
      .expect('c', true, 'ok')
      .report();
    assert.equal(report.passed, true);
    assert.equal(report.checks.length, 3);
  });
});

describe('findForbiddenClaims', () => {
  it('catches prices in several currencies', () => {
    for (const text of ['It costs $500', 'only AED 2,000', 'about 300 USD', 'from £99']) {
      assert.ok(findForbiddenClaims(text).length > 0, `missed a price in: ${text}`);
    }
  });

  it('catches guarantees and unverifiable outcome claims', () => {
    assert.ok(findForbiddenClaims('We guarantee results').length > 0);
    assert.ok(findForbiddenClaims('a 40% increase in revenue').length > 0);
    assert.ok(findForbiddenClaims('double your bookings').length > 0);
    assert.ok(findForbiddenClaims('full refund if unhappy').length > 0);
  });

  it('leaves an honest message alone', () => {
    const text =
      'I noticed your listing has no booking option. A booking system usually saves staff time on the phone. Would a short call be useful?';
    assert.deepEqual(findForbiddenClaims(text), []);
  });

  it('explains why each claim is forbidden', () => {
    for (const claim of findForbiddenClaims('We guarantee a 50% increase for $1000')) {
      assert.ok(claim.reason.length > 10);
    }
  });
});

describe('findImpersonation', () => {
  it('catches an AI implying it visited in person', () => {
    assert.ok(findImpersonation('I walked past your shop yesterday').length > 0);
    assert.ok(findImpersonation('I live nearby and love the food').length > 0);
    assert.ok(findImpersonation('When I was there last week...').length > 0);
  });

  it('accepts an honest AI disclosure', () => {
    const text = "I'm an AI assistant working with Acme. I reviewed your public listing.";
    assert.deepEqual(findImpersonation(text), []);
  });
});

describe('findSpamPhrases', () => {
  it('catches generic sales spam', () => {
    assert.ok(findSpamPhrases('Dear Sir/Madam, act now!').length > 0);
    assert.ok(findSpamPhrases('LIMITED TIME OFFER for you').length > 0);
  });

  it('is case-insensitive', () => {
    assert.ok(findSpamPhrases('dear sir/madam').length > 0);
    assert.ok(findSpamPhrases('DEAR SIR/MADAM').length > 0);
  });

  it('leaves a specific, personalised message alone', () => {
    assert.deepEqual(findSpamPhrases('Hello Cedar Cafe team, I noticed one thing about your setup.'), []);
  });
});

/**
 * Most of the pipeline is Riyadh and Dubai. English-only guards passed an
 * Arabic message that guaranteed a 50% sales increase and quoted a price, and
 * scored it 100/100 in the approval queue — the reviewer was being told the
 * message was clean while it broke three rules at once.
 */
describe('the guards read Arabic', () => {
  const pitch =
    'مرحباً، نضمن لك زيادة 50% في المبيعات خلال شهر. السعر 5000 ريال فقط. عرض لفترة محدودة، اشترِ الآن!';

  it('catches the guarantee, the price, the outcome claim and the spam', () => {
    const claims = findForbiddenClaims(pitch).map((c) => c.phrase);
    assert.ok(
      claims.some((c) => c.includes('نضمن')),
      'a guarantee is a commercial commitment in any language',
    );
    assert.ok(claims.some((c) => c.includes('ريال')), 'a quoted price must be caught');
    assert.ok(claims.some((c) => c.includes('%')), 'a quantified outcome claim must be caught');
    assert.ok(findSpamPhrases(pitch).length >= 2);
  });

  it('is not fooled by a different hamza, vowel marks or a stretched word', () => {
    // The same word, four ways it is really written.
    for (const text of ['أضمن لك النتائج', 'اضمن لك النتائج', 'نَضْمَن لك النتائج', 'نضـــمن لك النتائج']) {
      assert.ok(findForbiddenClaims(text).length > 0, `missed: ${text}`);
    }
  });

  it('reads Arabic-Indic digits as numbers', () => {
    assert.ok(findForbiddenClaims('التكلفة: ٥٠٠٠ ريال').length > 0);
    assert.ok(findForbiddenClaims('زيادة ٤٠٪ في الحجوزات').length > 0);
  });

  it('catches an AI claiming it visited the shop', () => {
    assert.ok(findImpersonation('زرت مقهاك الأسبوع الماضي وأعجبني المكان').length > 0);
    assert.ok(findImpersonation('أسكن قريباً منكم').length > 0);
  });

  it('leaves an honest Arabic message alone', () => {
    // Specific, evidence-based, no promise and no price — this must pass, or
    // the guards would block the only kind of message worth sending.
    const honest =
      'مرحباً فريق مقهى الأصيل، أنا مساعد ذكاء اصطناعي أعمل مع كريم. لاحظنا أن موقعكم لا يوفر طلباً أونلاين. هل عشر دقائق مكالمة مناسبة؟';
    assert.deepEqual(findForbiddenClaims(honest), []);
    assert.deepEqual(findSpamPhrases(honest), []);
    assert.deepEqual(findImpersonation(honest), []);
  });

  it('still catches everything it caught in English', () => {
    assert.ok(findForbiddenClaims('We guarantee 50% more revenue for $500').length >= 2);
    assert.ok(findSpamPhrases('Dear Sir/Madam, act now!').length > 0);
    assert.ok(findImpersonation('I walked past your shop yesterday').length > 0);
  });
});
