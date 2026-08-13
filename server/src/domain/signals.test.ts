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

  it('flags a missing website from the listing alone', () => {
    const signals = detectSignals(business({ website: null }));
    assert.ok(hasSignal(signals, 'no_website'));
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
