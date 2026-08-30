import {
  BOOKING_FAMILIES,
  HIGH_INQUIRY_FAMILIES,
  ORDERING_FAMILIES,
  SOURCE_PROVES_ABSENCE,
  categoryFamily,
  isPlausibleEmail,
  type DiscoveredBusiness,
} from './business';
import type { Signal, SignalKey } from '../types';

interface SignalSpec {
  key: SignalKey;
  label: string;
  weight: number;
}

const SPECS: Record<SignalKey, SignalSpec> = {
  no_website: { key: 'no_website', label: 'No website', weight: 26 },
  poor_website: { key: 'poor_website', label: 'Weak or outdated website', weight: 16 },
  no_mobile_app: { key: 'no_mobile_app', label: 'No mobile application', weight: 8 },
  no_online_ordering: { key: 'no_online_ordering', label: 'No online ordering', weight: 15 },
  poor_online_ordering: { key: 'poor_online_ordering', label: 'Poor online ordering experience', weight: 10 },
  no_booking_system: { key: 'no_booking_system', label: 'No booking system', weight: 15 },
  weak_customer_communication: {
    key: 'weak_customer_communication',
    label: 'Weak customer communication',
    weight: 9,
  },
  no_automation: { key: 'no_automation', label: 'No customer-facing automation', weight: 9 },
  poor_social_presence: { key: 'poor_social_presence', label: 'Little or no social presence', weight: 8 },
  repetitive_service_load: {
    key: 'repetitive_service_load',
    label: 'High volume of repetitive customer questions',
    weight: 9,
  },
  high_customer_activity: { key: 'high_customer_activity', label: 'High customer activity', weight: 10 },
  large_review_volume: { key: 'large_review_volume', label: 'Large review volume', weight: 7 },
  low_rating: { key: 'low_rating', label: 'Below-average rating', weight: 8 },
  no_public_email: { key: 'no_public_email', label: 'No public email address', weight: 4 },
  stale_listing: { key: 'stale_listing', label: 'Incomplete public listing', weight: 3 },
};

function signal(key: SignalKey, evidence: string, confidence: number): Signal {
  const spec = SPECS[key];
  return { key, label: spec.label, evidence, confidence, weight: spec.weight };
}

/**
 * Derives opportunity signals strictly from observed facts.
 *
 * Rules that keep this honest:
 *  - A missing observation never becomes a negative signal. `hasBookingSystem:
 *    undefined` means "we did not check", not "they have no booking system".
 *  - Every signal carries the evidence sentence that produced it, so the UI can
 *    always answer "why do you believe this?".
 */
export function detectSignals(business: DiscoveredBusiness): Signal[] {
  const signals: Signal[] = [];
  const family = categoryFamily(business.category);
  const obs = business.observations ?? {};
  const reviews = business.reviewCount ?? null;
  const rating = business.rating ?? null;
  const socialCount = Object.values(business.socialLinks ?? {}).filter(Boolean).length;

  // --- Web presence -------------------------------------------------------
  // Only an adapter that can prove absence sets `websiteStatus: 'none'`. A
  // blank website field on its own proves nothing — see SOURCE_PROVES_ABSENCE.
  if (obs.websiteStatus === 'none') {
    signals.push(
      signal('no_website', 'No website is listed on the public business profile.', 0.95),
    );
  } else if (obs.websiteStatus === 'broken') {
    signals.push(signal('poor_website', `The listed website (${business.website}) did not load.`, 0.9));
  } else if (obs.websiteStatus === 'basic') {
    signals.push(
      signal(
        'poor_website',
        `The website (${business.website}) is a single basic page with no customer self-service.`,
        0.75,
      ),
    );
  }

  if (obs.hasMobileApp === false) {
    signals.push(signal('no_mobile_app', 'No mobile application was found for this business.', 0.7));
  }

  // --- Transactional gaps (only where the category makes them relevant) ---
  if (ORDERING_FAMILIES.includes(family)) {
    if (obs.hasOnlineOrdering === false) {
      signals.push(
        signal(
          'no_online_ordering',
          `${business.category} customers expect to order online, and no ordering channel was found.`,
          0.85,
        ),
      );
    } else if (obs.hasOnlineOrdering === true && obs.websiteStatus === 'basic') {
      signals.push(
        signal(
          'poor_online_ordering',
          'Ordering exists but runs through a basic page with no order tracking.',
          0.6,
        ),
      );
    }
  }

  if (BOOKING_FAMILIES.includes(family) && obs.hasBookingSystem === false) {
    signals.push(
      signal(
        'no_booking_system',
        `${business.category} runs on appointments, and no online booking option was found.`,
        0.85,
      ),
    );
  }

  // --- Communication and automation --------------------------------------
  const proves = SOURCE_PROVES_ABSENCE[business.source];
  if (proves.phone && proves.email && !business.phone && !isPlausibleEmail(business.email)) {
    signals.push(
      signal(
        'weak_customer_communication',
        'Neither a public phone number nor a public email address is published.',
        0.9,
      ),
    );
  } else if (proves.email && !isPlausibleEmail(business.email)) {
    signals.push(signal('no_public_email', 'No public email address is published.', 0.85));
  }

  if (obs.hasLiveChat === false && obs.hasBookingSystem !== true && obs.hasOnlineOrdering !== true) {
    signals.push(
      signal(
        'no_automation',
        'No chat, booking or ordering automation is present — inbound demand is handled manually.',
        0.7,
      ),
    );
  }

  if (proves.social && socialCount === 0) {
    signals.push(signal('poor_social_presence', 'No social media profiles are linked publicly.', 0.8));
  }

  // --- Demand-side evidence ----------------------------------------------
  if (reviews !== null && reviews >= 200) {
    signals.push(
      signal(
        'high_customer_activity',
        `${reviews} public reviews indicate consistent customer volume.`,
        0.9,
      ),
    );
  }
  if (reviews !== null && reviews >= 500) {
    signals.push(
      signal('large_review_volume', `${reviews} reviews put this business in the top activity tier locally.`, 0.9),
    );
  }
  if (
    HIGH_INQUIRY_FAMILIES.includes(family) &&
    reviews !== null &&
    reviews >= 120 &&
    obs.hasLiveChat !== true
  ) {
    signals.push(
      signal(
        'repetitive_service_load',
        `A ${business.category} with ${reviews} reviews and no self-service channel absorbs repeated questions about hours, price and availability.`,
        0.7,
      ),
    );
  }
  if (rating !== null && rating > 0 && rating < 4.0) {
    signals.push(
      signal(
        'low_rating',
        `Public rating of ${rating.toFixed(1)} suggests customer-experience friction.`,
        0.8,
      ),
    );
  }
  if (!business.openingHours) {
    signals.push(signal('stale_listing', 'Opening hours are missing from the public listing.', 0.6));
  }

  return signals;
}

/** Weighted, confidence-adjusted contribution of a signal set (0..1). */
export function signalPressure(signals: Signal[]): number {
  const gained = signals.reduce((sum, s) => sum + s.weight * s.confidence, 0);
  // 70 points of weighted evidence is treated as a saturated opportunity.
  return Math.min(1, gained / 70);
}

export const hasSignal = (signals: Signal[], key: SignalKey): boolean =>
  signals.some((s) => s.key === key);
