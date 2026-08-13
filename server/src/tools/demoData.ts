import { categoryFamily, type CategoryFamily, type DiscoveredBusiness } from '../domain/business';
import { slug } from '../domain/business';

/**
 * Deterministic sample data used when no live discovery integration is
 * connected. Everything produced here is fictional and is flagged
 * `isDemo: true` end to end — the API, the CSV export and every dashboard
 * surface label it as demo data. It is never presented as real.
 */

export const DEMO_NOTICE =
  'Demo data: these businesses are fictional samples generated for evaluation. Connect Google Places to discover real businesses.';

/** Small deterministic PRNG so the same search always returns the same sample. */
function makeRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, items: T[]): T => items[Math.floor(rng() * items.length)];
const between = (rng: () => number, min: number, max: number): number =>
  Math.round(min + rng() * (max - min));

const NAME_PARTS: Record<CategoryFamily, { first: string[]; last: string[] }> = {
  food: {
    first: ['Golden', 'Cedar', 'Saffron', 'Blue Palm', 'Nile', 'Olive Tree', 'Marina', 'Desert Rose'],
    last: ['Kitchen', 'Grill', 'Bistro', 'Restaurant', 'Eatery', 'Cafe', 'Bakehouse'],
  },
  appointment: {
    first: ['Velvet', 'Pearl', 'Amber', 'Lotus', 'Bella', 'Crown', 'Serene'],
    last: ['Salon', 'Beauty Lounge', 'Barbershop', 'Spa', 'Nail Studio'],
  },
  health: {
    first: ['Bright', 'Al Noor', 'City', 'Harmony', 'Prime', 'Wellcare'],
    last: ['Dental Clinic', 'Medical Centre', 'Physiotherapy', 'Family Clinic'],
  },
  retail: {
    first: ['Urban', 'Corner', 'Nova', 'Green Leaf', 'Sunrise'],
    last: ['Boutique', 'Store', 'Market', 'Supplies'],
  },
  property: {
    first: ['Skyline', 'Anchor', 'Meridian', 'Palm Gate', 'Horizon'],
    last: ['Real Estate', 'Properties', 'Realty Group'],
  },
  automotive: {
    first: ['Apex', 'Falcon', 'Torque', 'Precision', 'Sandstorm'],
    last: ['Auto Workshop', 'Car Care', 'Garage', 'Detailing Studio'],
  },
  hospitality: {
    first: ['Coral', 'Lantern', 'Azure', 'Old Town'],
    last: ['Hotel', 'Suites', 'Guest House', 'Resort'],
  },
  services: {
    first: ['SparkClean', 'Prime', 'Iron', 'Summit', 'Reliable'],
    last: ['Cleaning Services', 'Fitness Club', 'Contracting', 'Laundry', 'Gym'],
  },
  other: {
    first: ['Meridian', 'Northstar', 'Bluebird'],
    last: ['Company', 'Services', 'Group'],
  },
};

const AREA_POOL: Record<string, string[]> = {
  Dubai: ['Al Barsha', 'Jumeirah', 'Business Bay', 'Deira', 'Al Quoz', 'Dubai Marina', 'Mirdif'],
  'Abu Dhabi': ['Al Reem Island', 'Khalifa City', 'Al Khalidiyah', 'Yas Island', 'Mussafah'],
  Riyadh: ['Al Olaya', 'Al Malaz', 'Hittin', 'Al Nakheel', 'Diriyah'],
  Doha: ['West Bay', 'Al Sadd', 'The Pearl', 'Msheireb'],
  Cairo: ['Maadi', 'Zamalek', 'Nasr City', 'New Cairo'],
  London: ['Shoreditch', 'Camden', 'Islington', 'Hackney'],
};

const DEFAULT_AREAS = ['City Centre', 'North District', 'Old Town', 'Business District'];

const SOCIAL_HOSTS = ['instagram.com', 'facebook.com', 'tiktok.com'];

/**
 * Demo profiles are drawn from four archetypes so the pipeline exercises the
 * full range: an obvious opportunity, a partial gap, a well-served business
 * (which should correctly score low), and a low-information listing.
 */
type Archetype = 'wide_open' | 'partial_gap' | 'well_served' | 'thin_data';

const ARCHETYPE_MIX: Archetype[] = [
  'wide_open',
  'partial_gap',
  'wide_open',
  'thin_data',
  'partial_gap',
  'well_served',
  'wide_open',
  'partial_gap',
];

function buildBusiness(
  rng: () => number,
  index: number,
  params: { country: string; city: string; area: string; category: string },
): DiscoveredBusiness {
  const family = categoryFamily(params.category);
  const parts = NAME_PARTS[family] ?? NAME_PARTS.other;
  const name = `${pick(rng, parts.first)} ${pick(rng, parts.last)}`;
  const archetype = ARCHETYPE_MIX[index % ARCHETYPE_MIX.length];

  const areaPool = AREA_POOL[params.city] ?? DEFAULT_AREAS;
  const area = params.area || pick(rng, areaPool);
  const handle = slug(name);

  const base: DiscoveredBusiness = {
    name,
    category: params.category,
    country: params.country,
    city: params.city,
    area,
    address: `${between(rng, 1, 240)} ${area}, ${params.city}`,
    phone: `+971 4 ${between(rng, 200, 899)} ${between(rng, 1000, 9999)}`,
    email: null,
    website: null,
    mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(`${name} ${params.city}`)}`,
    rating: Number((3.4 + rng() * 1.5).toFixed(1)),
    reviewCount: between(rng, 20, 900),
    openingHours: 'Mon–Sat 09:00–21:00',
    socialLinks: {},
    observations: {},
    source: 'demo',
    isDemo: true,
    externalId: `demo:${slug(params.city)}:${slug(params.category)}:${handle}:${index}`,
  };

  switch (archetype) {
    case 'wide_open':
      base.website = null;
      base.observations = {
        websiteStatus: 'none',
        hasOnlineOrdering: false,
        hasBookingSystem: false,
        hasMobileApp: false,
        hasLiveChat: false,
        respondsToReviews: false,
        priceLevel: between(rng, 1, 3),
      };
      base.reviewCount = between(rng, 180, 900);
      base.rating = Number((4.0 + rng() * 0.8).toFixed(1));
      if (rng() > 0.5) base.socialLinks = { instagram: `https://instagram.com/${handle}` };
      break;

    case 'partial_gap':
      base.website = `https://${handle}.example.com`;
      base.email = rng() > 0.4 ? `hello@${handle}.example.com` : null;
      base.observations = {
        websiteStatus: 'basic',
        hasOnlineOrdering: false,
        hasBookingSystem: false,
        hasMobileApp: false,
        hasLiveChat: false,
        respondsToReviews: rng() > 0.5,
        priceLevel: between(rng, 2, 4),
      };
      base.reviewCount = between(rng, 90, 480);
      base.socialLinks = {
        instagram: `https://${pick(rng, SOCIAL_HOSTS)}/${handle}`,
      };
      break;

    case 'well_served':
      base.website = `https://${handle}.example.com`;
      base.email = `contact@${handle}.example.com`;
      base.observations = {
        websiteStatus: 'modern',
        hasOnlineOrdering: true,
        hasBookingSystem: true,
        hasMobileApp: true,
        hasLiveChat: true,
        respondsToReviews: true,
        priceLevel: between(rng, 3, 4),
      };
      base.reviewCount = between(rng, 300, 1200);
      base.rating = Number((4.3 + rng() * 0.6).toFixed(1));
      base.socialLinks = {
        instagram: `https://instagram.com/${handle}`,
        facebook: `https://facebook.com/${handle}`,
      };
      break;

    case 'thin_data':
    default:
      // Sparse listing: most facts are simply unknown, which must reduce
      // confidence rather than invent negatives.
      base.website = null;
      base.email = null;
      base.phone = rng() > 0.5 ? base.phone : null;
      base.rating = rng() > 0.5 ? base.rating : null;
      base.reviewCount = rng() > 0.5 ? between(rng, 3, 40) : null;
      base.openingHours = null;
      base.observations = { websiteStatus: 'none' };
      break;
  }

  return base;
}

export function generateDemoBusinesses(params: {
  country: string;
  city: string;
  area?: string;
  category: string;
  limit?: number;
}): DiscoveredBusiness[] {
  const limit = Math.min(Math.max(params.limit ?? 12, 1), 40);
  const seed = `${params.country}|${params.city}|${params.area ?? ''}|${params.category}`;
  const rng = makeRng(seed);

  const results: DiscoveredBusiness[] = [];
  const seen = new Set<string>();
  let guard = 0;

  while (results.length < limit && guard < limit * 12) {
    guard += 1;
    const business = buildBusiness(rng, results.length, {
      country: params.country,
      city: params.city,
      area: params.area ?? '',
      category: params.category,
    });
    const key = `${business.name}|${business.area}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(business);
  }

  return results;
}

export const DEMO_CATEGORIES = [
  'Restaurants',
  'Cafes',
  'Beauty salons',
  'Dental clinics',
  'Gyms',
  'Car workshops',
  'Real estate offices',
  'Hotels',
  'Cleaning companies',
  'Beauty clinics',
  'Contractors',
  'Retail shops',
];

export const DEMO_LOCATIONS = [
  { country: 'United Arab Emirates', city: 'Dubai' },
  { country: 'United Arab Emirates', city: 'Abu Dhabi' },
  { country: 'Saudi Arabia', city: 'Riyadh' },
  { country: 'Qatar', city: 'Doha' },
  { country: 'Egypt', city: 'Cairo' },
  { country: 'United Kingdom', city: 'London' },
];
