import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SERVICE_CATALOG, estimateValue, rankServices } from './services';
import { detectSignals } from './signals';
import type { DiscoveredBusiness } from './business';

function business(overrides: Partial<DiscoveredBusiness> = {}): DiscoveredBusiness {
  return {
    name: 'Test Salon',
    category: 'Beauty salons',
    country: 'United Arab Emirates',
    city: 'Dubai',
    area: '',
    phone: '+971 4 555 6666',
    email: null,
    website: null,
    mapsUrl: null,
    rating: 4.6,
    reviewCount: 320,
    openingHours: 'Daily 10:00–22:00',
    socialLinks: {},
    observations: {
      websiteStatus: 'none',
      hasBookingSystem: false,
      hasLiveChat: false,
      hasMobileApp: false,
      priceLevel: 3,
    },
    source: 'demo',
    isDemo: true,
    ...overrides,
  };
}

describe('rankServices', () => {
  it('only returns services whose triggering evidence was observed', () => {
    const subject = business();
    const signals = detectSignals(subject);
    const observed = new Set(signals.map((signal) => signal.key));

    for (const match of rankServices(subject, signals)) {
      const supported = match.service.requiredSignals.some((required) => observed.has(required));
      assert.ok(supported, `${match.service.key} was recommended without supporting evidence`);
      assert.ok(match.matchedSignals.length > 0);
    }
  });

  it('recommends nothing when there is no evidence at all', () => {
    const matches = rankServices(business(), []);
    assert.equal(matches.length, 0);
  });

  it('respects the configured list of services actually sold', () => {
    const subject = business();
    const signals = detectSignals(subject);
    const matches = rankServices(subject, signals, ['website']);
    assert.ok(matches.every((match) => match.service.key === 'website'));
  });

  it('prefers a booking system for an appointment business over a generic option', () => {
    const subject = business();
    const matches = rankServices(subject, detectSignals(subject));
    const bookingRank = matches.findIndex((match) => match.service.key === 'booking_system');
    const socialRank = matches.findIndex((match) => match.service.key === 'social_media_automation');
    assert.ok(bookingRank !== -1, 'a salon with no booking option should surface a booking system');
    if (socialRank !== -1) assert.ok(bookingRank < socialRank);
  });

  it('carries a human-readable rationale on every match', () => {
    const subject = business();
    for (const match of rankServices(subject, detectSignals(subject))) {
      assert.ok(match.rationale.includes(match.service.label));
    }
  });
});

describe('estimateValue', () => {
  it('stays inside the published band for the service', () => {
    for (const service of SERVICE_CATALOG) {
      for (const reviews of [0, 50, 500, 5000]) {
        const value = estimateValue(service, business({ reviewCount: reviews }));
        assert.ok(
          value >= service.valueBand.low * 0.8 && value <= service.valueBand.high * 1.2,
          `${service.key} estimated ${value} outside its band at ${reviews} reviews`,
        );
      }
    }
  });

  it('scales with observable business size', () => {
    const service = SERVICE_CATALOG.find((entry) => entry.key === 'booking_system')!;
    const small = estimateValue(service, business({ reviewCount: 5 }));
    const large = estimateValue(service, business({ reviewCount: 2000 }));
    assert.ok(large > small, 'a busier business should carry a higher estimate');
  });
});
