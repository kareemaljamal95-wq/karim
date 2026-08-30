import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectSignals, hasSignal } from './signals';
import type { DiscoveredBusiness } from './business';

function business(overrides: Partial<DiscoveredBusiness> = {}): DiscoveredBusiness {
  return {
    name: 'Test Clinic',
    category: 'Dental clinics',
    country: 'United Arab Emirates',
    city: 'Dubai',
    area: '',
    phone: '+971 4 111 2222',
    email: 'hello@clinic.example.com',
    website: 'https://clinic.example.com',
    mapsUrl: null,
    rating: 4.5,
    reviewCount: 150,
    openingHours: 'Mon–Fri 09:00–18:00',
    socialLinks: { instagram: 'https://instagram.com/clinic' },
    observations: {},
    source: 'demo',
    isDemo: true,
    ...overrides,
  };
}

describe('detectSignals', () => {
  it('never turns an unchecked observation into a negative signal', () => {
    // `observations` is empty: nothing was verified, so nothing may be claimed.
    const signals = detectSignals(business());
    assert.equal(hasSignal(signals, 'no_booking_system'), false);
    assert.equal(hasSignal(signals, 'no_mobile_app'), false);
    assert.equal(hasSignal(signals, 'no_online_ordering'), false);
  });

  it('only reports a gap that was actually observed', () => {
    const signals = detectSignals(business({ observations: { hasBookingSystem: false } }));
    assert.ok(hasSignal(signals, 'no_booking_system'));
  });

  it('flags a missing website only when the source can prove it is missing', () => {
    // Google Places lists every website it knows, so its adapter asserts 'none'.
    const proven = detectSignals(business({ website: null, observations: { websiteStatus: 'none' } }));
    assert.ok(hasSignal(proven, 'no_website'));

    // A blank field on its own is an absence of information. OpenStreetMap is
    // volunteer-maintained: an untagged website is unrecorded, not non-existent.
    const unproven = detectSignals(business({ website: null, source: 'openstreetmap', isDemo: false }));
    assert.equal(hasSignal(unproven, 'no_website'), false);
  });

  it('claims a missing email or social profile only where the source would have carried it', () => {
    const sparse = { email: null, phone: null, socialLinks: {} } as const;

    // Demo fixtures are complete by construction, so their blanks are meaningful.
    const demo = detectSignals(business({ ...sparse }));
    assert.ok(hasSignal(demo, 'weak_customer_communication'));
    assert.ok(hasSignal(demo, 'poor_social_presence'));

    // Places never exposes an email address or a social profile for anyone, so
    // their absence says nothing about this business in particular.
    const places = detectSignals(business({ ...sparse, source: 'google_places', isDemo: false }));
    assert.equal(hasSignal(places, 'weak_customer_communication'), false);
    assert.equal(hasSignal(places, 'no_public_email'), false);
    assert.equal(hasSignal(places, 'poor_social_presence'), false);

    const osm = detectSignals(business({ ...sparse, source: 'openstreetmap', isDemo: false }));
    assert.equal(hasSignal(osm, 'no_public_email'), false);
    assert.equal(hasSignal(osm, 'poor_social_presence'), false);
  });

  it('does not raise ordering gaps for categories where ordering is irrelevant', () => {
    const signals = detectSignals(
      business({ category: 'Real estate offices', observations: { hasOnlineOrdering: false } }),
    );
    assert.equal(hasSignal(signals, 'no_online_ordering'), false);
  });

  it('attaches evidence and a confidence to every signal', () => {
    const signals = detectSignals(business({ website: null, socialLinks: {} }));
    assert.ok(signals.length > 0);
    for (const signal of signals) {
      assert.ok(signal.evidence.length > 10, `signal ${signal.key} has no usable evidence`);
      assert.ok(signal.confidence > 0 && signal.confidence <= 1);
      assert.ok(signal.weight > 0);
    }
  });

  it('treats high review volume as demand, not as a deficiency', () => {
    const signals = detectSignals(business({ reviewCount: 600 }));
    assert.ok(hasSignal(signals, 'high_customer_activity'));
    assert.ok(hasSignal(signals, 'large_review_volume'));
  });
});
