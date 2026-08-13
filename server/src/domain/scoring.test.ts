import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreLead, scoreOpportunity } from './scoring';
import { detectSignals } from './signals';
import { rankServices, estimateValue } from './services';
import type { DiscoveredBusiness } from './business';

function business(overrides: Partial<DiscoveredBusiness> = {}): DiscoveredBusiness {
  return {
    name: 'Test Restaurant',
    category: 'Restaurants',
    country: 'United Arab Emirates',
    city: 'Dubai',
    area: 'Al Barsha',
    phone: '+971 4 123 4567',
    email: 'hello@test.example.com',
    website: null,
    mapsUrl: null,
    rating: 4.4,
    reviewCount: 400,
    openingHours: 'Mon–Sat 09:00–21:00',
    socialLinks: {},
    observations: {
      websiteStatus: 'none',
      hasOnlineOrdering: false,
      hasBookingSystem: false,
      hasMobileApp: false,
      hasLiveChat: false,
      priceLevel: 2,
    },
    source: 'demo',
    isDemo: true,
    ...overrides,
  };
}

function scoreFor(input: DiscoveredBusiness) {
  const signals = detectSignals(input);
  const opportunity = scoreOpportunity(input, signals);
  const matches = rankServices(input, signals);
  const top = matches[0] ?? null;
  const value = top ? estimateValue(top.service, input) : 0;
  return { signals, opportunity, top, result: scoreLead(input, signals, opportunity, top, value) };
}

describe('scoreOpportunity', () => {
  it('keeps the score inside 0-100', () => {
    const { opportunity } = scoreFor(business());
    assert.ok(opportunity.score >= 0 && opportunity.score <= 100);
  });

  it('scores a well-served business far below one with obvious gaps', () => {
    const wideOpen = scoreFor(business()).opportunity.score;
    const wellServed = scoreFor(
      business({
        website: 'https://good.example.com',
        socialLinks: { instagram: 'https://instagram.com/good' },
        observations: {
          websiteStatus: 'modern',
          hasOnlineOrdering: true,
          hasBookingSystem: true,
          hasMobileApp: true,
          hasLiveChat: true,
          priceLevel: 3,
        },
      }),
    ).opportunity.score;

    assert.ok(
      wellServed < wideOpen,
      `expected the well-served business (${wellServed}) to score below the wide-open one (${wideOpen})`,
    );
  });

  it('reports low confidence when public data is sparse', () => {
    const sparse = scoreFor(
      business({
        phone: null,
        email: null,
        rating: null,
        reviewCount: null,
        openingHours: null,
        observations: {},
      }),
    );
    assert.ok(sparse.opportunity.confidence < 0.6, 'sparse listings must not produce confident scores');
  });
});

describe('scoreLead', () => {
  it('maps scores onto the documented A/B/C bands', () => {
    const { result } = scoreFor(business());
    const expected = result.score >= 75 ? 'A' : result.score >= 55 ? 'B' : 'C';
    assert.equal(result.grade, expected);
  });

  it('produces a value for all seven dimensions', () => {
    const { result } = scoreFor(business());
    const dimensions = Object.values(result.breakdown);
    assert.equal(dimensions.length, 7);
    for (const value of dimensions) {
      assert.ok(value >= 0 && value <= 100, `dimension out of range: ${value}`);
    }
  });

  it('caps an unreachable lead out of grade A and explains why', () => {
    const { result } = scoreFor(business({ phone: null, email: null }));
    assert.ok(result.score <= 45, `unreachable lead scored ${result.score}`);
    assert.notEqual(result.grade, 'A');
    assert.ok(
      result.caveats.some((caveat) => /contact/i.test(caveat)),
      'a missing contact channel must be surfaced as a caveat',
    );
  });

  it('caps the score when the evidence is too thin to be confident', () => {
    const { result, opportunity } = scoreFor(
      business({ rating: null, reviewCount: null, openingHours: null, observations: {} }),
    );
    if (opportunity.confidence < 0.5) {
      assert.ok(result.score <= 64, `low-confidence lead scored ${result.score}`);
    }
  });

  it('always carries a written justification', () => {
    const { result } = scoreFor(business());
    assert.ok(result.justification.length > 20);
  });
});
