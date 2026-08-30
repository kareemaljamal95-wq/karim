/**
 * Business discovery through OpenStreetMap.
 *
 * A credential-free alternative to Google Places, for operators who cannot get
 * a Places key — Google Cloud requires a billing account, which in some
 * countries is only available through a reseller and only to registered
 * companies. OSM needs no key, no billing and no contract.
 *
 * Two public endpoints are used: Nominatim to turn "Al Olaya, Riyadh, Saudi
 * Arabia" into a bounding box, then Overpass to list the businesses inside it.
 *
 * What OSM can and cannot prove matters here. It carries phone numbers,
 * websites, opening hours and — unlike Places — published email addresses, so
 * those are passed through as observed facts. It carries no ratings and no
 * review counts, so those stay null. And because OSM is volunteer-maintained,
 * a *missing* website tag means nobody has recorded one, not that the business
 * has no site: `websiteStatus` is therefore left unknown rather than set to
 * 'none' the way the Places adapter can. Inferring a gap from an absent tag
 * would manufacture the exact kind of unverified deficiency the platform is
 * built to refuse.
 */
import { recordIntegrationCheck, isActive } from '../services/integrations';
import { categoryFamily, type CategoryFamily, type DiscoveredBusiness } from '../domain/business';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/**
 * Overpass endpoints, tried in order.
 *
 * The public instances are free and heavily shared, so a busy one answers 429
 * or 504 rather than failing outright. Mirrors run the same API over the same
 * data, so moving to the next one is a retry, not a change of source.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Both services ask for a descriptive agent string identifying the client. */
const USER_AGENT = 'ai-ceo-platform/1.0 (agentic business discovery; contact via deployment operator)';

const REQUEST_TIMEOUT_MS = 30_000;
/** Overpass is a free shared service — stay well inside a polite request size. */
const MAX_RESULTS = 30;
/** ~2 km: the smallest area worth searching, see `padBox`. */
const MIN_AREA_SPAN_DEGREES = 0.02;

export const openStreetMapAvailable = (): boolean => isActive('open_street_map');

export interface OsmSearchParams {
  country: string;
  city: string;
  area?: string;
  category: string;
  limit?: number;
}

/**
 * Overpass tag selectors per business kind.
 *
 * Keyword matches win over the family fallback, because "dental clinic" and
 * "car workshop" both land in families whose generic selectors are far too
 * broad to be useful.
 */
const KEYWORD_SELECTORS: { match: RegExp; selectors: string[] }[] = [
  { match: /dental|dentist/i, selectors: ['amenity=dentist', 'healthcare=dentist'] },
  { match: /pharmac/i, selectors: ['amenity=pharmacy'] },
  { match: /veterinar/i, selectors: ['amenity=veterinary'] },
  { match: /clinic|medical|doctor|physio/i, selectors: ['amenity=clinic', 'amenity=doctors', 'healthcare=clinic'] },
  { match: /hospital/i, selectors: ['amenity=hospital'] },
  { match: /barber/i, selectors: ['shop=hairdresser'] },
  { match: /salon|beauty|nail|spa|massage/i, selectors: ['shop=beauty', 'shop=hairdresser', 'leisure=spa'] },
  { match: /gym|fitness|yoga/i, selectors: ['leisure=fitness_centre'] },
  { match: /caf[eé]|coffee/i, selectors: ['amenity=cafe'] },
  { match: /bakery|pastry/i, selectors: ['shop=bakery'] },
  { match: /restaurant|dining|grill|shawarma|pizzeria/i, selectors: ['amenity=restaurant'] },
  { match: /fast food|burger|takeaway/i, selectors: ['amenity=fast_food'] },
  { match: /car (repair|workshop|service)|workshop|garage|mechanic/i, selectors: ['shop=car_repair'] },
  { match: /tyre|tire/i, selectors: ['shop=tyres'] },
  { match: /car wash|detailing/i, selectors: ['amenity=car_wash'] },
  { match: /car dealer|car showroom/i, selectors: ['shop=car'] },
  { match: /real estate|realty|property|broker/i, selectors: ['office=estate_agent'] },
  { match: /hotel|resort|guest house|hostel/i, selectors: ['tourism=hotel', 'tourism=guest_house'] },
  { match: /travel/i, selectors: ['shop=travel_agency'] },
  { match: /laundry|dry clean/i, selectors: ['shop=laundry', 'shop=dry_cleaning'] },
  { match: /florist|flower/i, selectors: ['shop=florist'] },
  { match: /supermarket|grocery/i, selectors: ['shop=supermarket', 'shop=convenience'] },
  { match: /boutique|clothing|fashion/i, selectors: ['shop=clothes'] },
  { match: /furniture/i, selectors: ['shop=furniture'] },
  { match: /electronics|mobile phone/i, selectors: ['shop=electronics', 'shop=mobile_phone'] },
  { match: /jewel/i, selectors: ['shop=jewelry'] },
  { match: /optic/i, selectors: ['shop=optician'] },
  { match: /school|academy|training|institute/i, selectors: ['amenity=school', 'amenity=college'] },
  { match: /law|legal|advocate/i, selectors: ['office=lawyer'] },
  { match: /account(ing|ant)|audit/i, selectors: ['office=accountant'] },
  { match: /market(ing)? agency|advertis/i, selectors: ['office=advertising_agency'] },
];

/** Family fallbacks, used when no keyword matched the requested category. */
const FAMILY_SELECTORS: Record<CategoryFamily, string[]> = {
  food: ['amenity=restaurant', 'amenity=cafe', 'amenity=fast_food'],
  appointment: ['shop=beauty', 'shop=hairdresser'],
  health: ['amenity=clinic', 'amenity=doctors', 'amenity=dentist'],
  retail: ['shop=convenience', 'shop=clothes', 'shop=supermarket'],
  property: ['office=estate_agent'],
  automotive: ['shop=car_repair', 'shop=car'],
  hospitality: ['tourism=hotel', 'tourism=guest_house'],
  services: ['office=company', 'shop=laundry'],
  other: ['office=company', 'shop=convenience'],
};

/**
 * The Overpass tag selectors that best match a free-text category.
 *
 * The first matching rule wins, and the table above is ordered specific before
 * general: "Dental clinics" must search dentists, not every clinic and doctor
 * in the city, so `/dental/` is listed ahead of `/clinic/`.
 */
export function osmSelectorsFor(category: string): string[] {
  const matched = KEYWORD_SELECTORS.find((entry) => entry.match.test(category));
  if (matched) return [...new Set(matched.selectors)];
  return FAMILY_SELECTORS[categoryFamily(category)];
}

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const SOCIAL_TAGS: Record<string, string> = {
  'contact:facebook': 'facebook',
  'contact:instagram': 'instagram',
  'contact:twitter': 'twitter',
  'contact:linkedin': 'linkedin',
  'contact:whatsapp': 'whatsapp',
  facebook: 'facebook',
  instagram: 'instagram',
};

/** Turns the matched OSM tag back into a readable category label. */
function labelFor(tags: Record<string, string>, fallback: string): string {
  for (const key of ['amenity', 'shop', 'office', 'healthcare', 'tourism', 'leisure']) {
    const value = tags[key];
    if (value) return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
  return fallback;
}

function addressOf(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:district'],
    tags['addr:city'],
  ].filter((part) => Boolean(part && part.trim()));
  return parts.length ? parts.join(', ') : null;
}

/**
 * Maps one Overpass element onto a discovered business.
 *
 * Returns null for anything that cannot be a lead: unnamed features, and
 * objects tagged as no longer operating.
 */
export function mapOsmElement(element: OsmElement, params: OsmSearchParams): DiscoveredBusiness | null {
  const tags = element.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;
  // `disused:shop=…` / `was:amenity=…` mark a business that has closed.
  if (Object.keys(tags).some((key) => key.startsWith('disused:') || key.startsWith('was:'))) return null;

  const socialLinks: Record<string, string> = {};
  for (const [tag, platform] of Object.entries(SOCIAL_TAGS)) {
    const value = tags[tag];
    if (value) socialLinks[platform] = value;
  }

  return {
    name,
    category: labelFor(tags, params.category),
    country: params.country,
    // `addr:city` is tagged in the local language ("دبي"), which would split the
    // CRM's city filter in two. The English variant, where mapped, is the same
    // fact in the language the rest of the record uses.
    city: tags['addr:city:en']?.trim() || tags['addr:city']?.trim() || params.city,
    area: params.area ?? '',
    address: addressOf(tags),
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    // Unlike Places, OSM does carry published email addresses. This is an
    // observed value from the map data, never derived from a website domain.
    email: tags.email ?? tags['contact:email'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    mapsUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    // OSM has no rating system at all — not zero, unknown.
    rating: null,
    reviewCount: null,
    openingHours: tags.opening_hours ?? null,
    socialLinks,
    observations: {
      // Deliberately empty. A missing tag in a volunteer-maintained map is an
      // absence of information, not evidence that the business lacks a website
      // or a booking system.
    },
    source: 'openstreetmap',
    isDemo: false,
    externalId: `osm:${element.type}/${element.id}`,
  } satisfies DiscoveredBusiness;
}

export interface BoundingBox {
  south: number;
  north: number;
  west: number;
  east: number;
  label: string;
}

interface NominatimResult {
  boundingbox?: [string, string, string, string];
  lat?: string;
  lon?: string;
  display_name?: string;
}

export function parseBox(result: NominatimResult): BoundingBox | null {
  const box = result.boundingbox;
  if (!box) return null;
  const parsed = {
    south: Number(box[0]),
    north: Number(box[1]),
    west: Number(box[2]),
    east: Number(box[3]),
    label: result.display_name ?? '',
  };
  return Object.values(parsed).some((v) => typeof v === 'number' && Number.isNaN(v)) ? null : parsed;
}

/**
 * Grows a box to a minimum span around its centre.
 *
 * Nominatim returns a point-sized box for many districts — the accepted Al
 * Olaya box is about 250 m across, which would return a handful of businesses
 * from a district that holds hundreds. Padding to a couple of kilometres keeps
 * the search recognisably "that area" while returning a usable batch. It is
 * clamped so it can never grow past the city it came from.
 */
export function padBox(box: BoundingBox, minSpan: number, limit?: BoundingBox): BoundingBox {
  const grow = (low: number, high: number, outerLow: number, outerHigh: number) => {
    const centre = (low + high) / 2;
    const half = Math.max((high - low) / 2, minSpan / 2);
    return [Math.max(centre - half, outerLow), Math.min(centre + half, outerHigh)] as const;
  };
  const [south, north] = grow(box.south, box.north, limit?.south ?? -90, limit?.north ?? 90);
  const [west, east] = grow(box.west, box.east, limit?.west ?? -180, limit?.east ?? 180);
  return { ...box, south, north, west, east };
}

/**
 * Whether a candidate box sits inside an outer one.
 *
 * Place names repeat across a country — searching "Al Olaya, Riyadh" returns a
 * same-named neighbourhood two hundred kilometres away ahead of the real one.
 * An area is only accepted when it actually falls within the city it was asked
 * for; otherwise the city box is used and the caller says so.
 */
export function boxWithin(outer: BoundingBox, inner: BoundingBox): boolean {
  const centreLat = (inner.south + inner.north) / 2;
  const centreLon = (inner.west + inner.east) / 2;
  return (
    centreLat >= outer.south && centreLat <= outer.north && centreLon >= outer.west && centreLon <= outer.east
  );
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function nominatim(query: string, limit: number): Promise<NominatimResult[]> {
  const response = await fetchWithTimeout(`${NOMINATIM}?${query}&format=json&limit=${limit}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Location lookup failed: HTTP ${response.status}`);
  return (await response.json().catch(() => [])) as NominatimResult[];
}

/**
 * Resolves the search area to a bounding box.
 *
 * The city is looked up with Nominatim's structured parameters, which are far
 * more reliable than free text. A requested area is then resolved separately
 * and only accepted if it lies inside that city — see `boxWithin`.
 */
async function geocode(params: OsmSearchParams): Promise<{ box: BoundingBox; areaNotice: string | null }> {
  const cityQuery = `city=${encodeURIComponent(params.city)}&country=${encodeURIComponent(params.country)}`;
  const cityBox = parseBox((await nominatim(cityQuery, 1))[0] ?? {});
  if (!cityBox) {
    throw new Error(`OpenStreetMap does not know the city "${params.city}, ${params.country}"`);
  }

  const area = params.area?.trim();
  if (!area) return { box: cityBox, areaNotice: null };

  const location = `${area}, ${params.city}, ${params.country}`;
  const candidates = await nominatim(`q=${encodeURIComponent(location)}`, 5);
  for (const candidate of candidates) {
    const box = parseBox(candidate);
    if (box && boxWithin(cityBox, box)) {
      return { box: padBox(box, MIN_AREA_SPAN_DEGREES, cityBox), areaNotice: null };
    }
  }

  return {
    box: cityBox,
    areaNotice: `OpenStreetMap could not place "${area}" inside ${params.city}, so the whole city was searched.`,
  };
}

/** Builds the Overpass QL query for a set of selectors inside a box. */
export function overpassQuery(selectors: string[], box: BoundingBox, limit: number): string {
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;
  const clauses = selectors
    .map((selector) => {
      const [key, value] = selector.split('=');
      return `nwr["${key}"="${value}"]["name"](${bbox});`;
    })
    .join('\n  ');
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout center ${limit};`;
}

/**
 * Runs a query against the Overpass endpoints in turn.
 *
 * A busy public instance replies 429 or 504; that is worth trying the next
 * mirror for. A 400 means the query itself is wrong, so it fails immediately
 * rather than repeating a bad request across every endpoint.
 */
async function queryOverpass(data: string): Promise<{ elements?: OsmElement[] }> {
  let lastDetail = 'no Overpass endpoint responded';

  for (const endpoint of OVERPASS_ENDPOINTS) {
    let response: Response;
    try {
      response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ data }).toString(),
      });
    } catch (error) {
      lastDetail = error instanceof Error && error.name === 'AbortError' ? 'the request timed out' : 'network error';
      continue;
    }

    if (response.ok) return (await response.json().catch(() => ({}))) as { elements?: OsmElement[] };

    if (response.status === 400) {
      throw new Error('OpenStreetMap rejected the search query');
    }
    lastDetail =
      response.status === 429 || response.status === 504
        ? 'every public Overpass instance is rate-limiting or busy — try again in a minute'
        : `HTTP ${response.status}`;
  }

  throw new Error(`OpenStreetMap search failed: ${lastDetail}`);
}

/**
 * Live business discovery through OpenStreetMap.
 *
 * Only fields the map data actually contains are mapped; everything else stays
 * null so the analyst treats it as unknown.
 */
export async function searchOpenStreetMap(
  params: OsmSearchParams,
): Promise<{ businesses: DiscoveredBusiness[]; query: string; notice: string | null }> {
  const locationParts = [params.area, params.city, params.country].filter(Boolean).join(', ');
  const query = `${params.category} in ${locationParts}`;
  const limit = Math.min(Math.max(params.limit ?? 20, 1), MAX_RESULTS);
  const selectors = osmSelectorsFor(params.category);

  try {
    const { box, areaNotice } = await geocode(params);
    const payload = await queryOverpass(overpassQuery(selectors, box, limit));
    const businesses = (payload.elements ?? [])
      .map((element) => mapOsmElement(element, params))
      .filter((business): business is DiscoveredBusiness => business !== null)
      .slice(0, limit);

    recordIntegrationCheck('open_street_map', null);
    return { businesses, query, notice: areaNotice };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'OpenStreetMap did not respond in time'
          : error.message
        : 'Unknown OpenStreetMap error';
    recordIntegrationCheck('open_street_map', message);
    throw new Error(message);
  }
}
