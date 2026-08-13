/** A business as discovered by the Market Scout, before analysis. */
export interface DiscoveredBusiness {
  name: string;
  category: string;
  country: string;
  city: string;
  area: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  mapsUrl?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  openingHours?: string | null;
  socialLinks?: Record<string, string>;
  /**
   * Observed digital-presence facts. `undefined` means "not observed" and is
   * never treated as a negative — the analyst may only reason from evidence
   * that actually exists.
   */
  observations?: {
    websiteStatus?: 'none' | 'broken' | 'basic' | 'modern';
    hasOnlineOrdering?: boolean;
    hasBookingSystem?: boolean;
    hasMobileApp?: boolean;
    hasLiveChat?: boolean;
    respondsToReviews?: boolean;
    priceLevel?: number;
  };
  source: 'google_places' | 'demo' | 'manual' | 'import';
  isDemo: boolean;
  externalId?: string | null;
}

/** Category families drive which digital gaps are even relevant. */
export type CategoryFamily =
  | 'food'
  | 'appointment'
  | 'retail'
  | 'property'
  | 'automotive'
  | 'hospitality'
  | 'services'
  | 'health'
  | 'other';

const FAMILY_KEYWORDS: Record<CategoryFamily, string[]> = {
  food: ['restaurant', 'cafe', 'coffee', 'bakery', 'catering', 'food', 'pizzeria', 'grill', 'shawarma'],
  appointment: ['salon', 'barber', 'spa', 'beauty', 'nail', 'massage', 'tattoo'],
  health: ['dental', 'dentist', 'clinic', 'medical', 'physio', 'doctor', 'veterinar', 'pharmacy'],
  retail: ['shop', 'store', 'boutique', 'grocery', 'supermarket', 'retail', 'florist'],
  property: ['real estate', 'realty', 'property', 'broker'],
  automotive: ['car', 'auto', 'workshop', 'garage', 'tyre', 'tire', 'mechanic', 'detailing'],
  hospitality: ['hotel', 'resort', 'guest house', 'hostel', 'travel'],
  services: ['cleaning', 'contractor', 'plumb', 'electric', 'landscap', 'moving', 'laundry', 'gym', 'fitness', 'yoga'],
  other: [],
};

export function categoryFamily(category: string): CategoryFamily {
  const c = category.toLowerCase();
  for (const [family, keywords] of Object.entries(FAMILY_KEYWORDS) as [CategoryFamily, string[]][]) {
    if (keywords.some((k) => c.includes(k))) return family;
  }
  return 'other';
}

/** Families where customers expect to order online. */
export const ORDERING_FAMILIES: CategoryFamily[] = ['food', 'retail'];
/** Families where customers expect to book a slot. */
export const BOOKING_FAMILIES: CategoryFamily[] = ['appointment', 'health', 'automotive', 'hospitality', 'services'];
/** Families with heavy repetitive inbound questions (hours, price, availability). */
export const HIGH_INQUIRY_FAMILIES: CategoryFamily[] = [
  'food',
  'appointment',
  'health',
  'property',
  'automotive',
  'hospitality',
  'services',
];

/**
 * Stable key used to detect duplicates across research runs. Built from the
 * strongest available identifier so the same business is never imported twice.
 */
export function dedupeKey(business: {
  externalId?: string | null;
  name: string;
  city: string;
  phone?: string | null;
  website?: string | null;
}): string {
  if (business.externalId) return `ext:${business.externalId}`;
  const phone = normalisePhone(business.phone);
  if (phone) return `tel:${phone}`;
  const host = websiteHost(business.website);
  if (host) return `web:${host}`;
  return `name:${slug(business.name)}|${slug(business.city)}`;
}

export function normalisePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.length >= 7 ? digits : null;
}

export function websiteHost(website?: string | null): string | null {
  if (!website) return null;
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export const slug = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isPlausibleEmail = (email?: string | null): boolean =>
  Boolean(email && EMAIL_RE.test(email.trim()));
