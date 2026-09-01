import { getCredentials, isActive, recordIntegrationCheck } from '../services/integrations';
import type { DiscoveredBusiness } from '../domain/business';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.priceLevel',
  'places.businessStatus',
].join(',');

interface PlacesResponse {
  places?: {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    primaryTypeDisplayName?: { text?: string };
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    googleMapsUri?: string;
    rating?: number;
    userRatingCount?: number;
    regularOpeningHours?: { weekdayDescriptions?: string[] };
    priceLevel?: string;
    businessStatus?: string;
  }[];
  error?: { message?: string };
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export const googlePlacesAvailable = (): boolean => isActive('google_places');

export interface PlacesSearchParams {
  country: string;
  city: string;
  area?: string;
  category: string;
  limit?: number;
}

/**
 * Live business discovery through the official Google Places API.
 *
 * Only fields the API actually returns are mapped. Anything Places does not
 * expose — email addresses, social profiles, whether a booking system exists —
 * is left `null`/`undefined` so the analyst treats it as unknown rather than
 * inventing it.
 */
export async function searchGooglePlaces(
  params: PlacesSearchParams,
): Promise<{ businesses: DiscoveredBusiness[]; query: string }> {
  const apiKey = getCredentials('google_places').apiKey;
  if (!apiKey) throw new Error('Google Places is not configured');

  const locationParts = [params.area, params.city, params.country].filter(Boolean).join(', ');
  const query = `${params.category} in ${locationParts}`;
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 20);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: limit }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    recordIntegrationCheck('google_places', message);
    throw new Error(`Google Places request failed: ${message}`);
  }

  const payload = (await response.json().catch(() => ({}))) as PlacesResponse;

  if (!response.ok) {
    const message = payload.error?.message ?? `HTTP ${response.status}`;
    recordIntegrationCheck('google_places', message);
    throw new Error(`Google Places returned an error: ${message}`);
  }

  recordIntegrationCheck('google_places', null);

  const businesses: DiscoveredBusiness[] = (payload.places ?? [])
    .filter((place) => place.businessStatus !== 'CLOSED_PERMANENTLY')
    .map((place) => {
      const website = place.websiteUri ?? null;
      return {
        name: place.displayName?.text ?? 'Unknown business',
        category: place.primaryTypeDisplayName?.text ?? params.category,
        country: params.country,
        city: params.city,
        area: params.area ?? '',
        address: place.formattedAddress ?? null,
        phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
        // Places does not expose email addresses. Leaving this null is
        // deliberate — the platform never guesses contact details.
        email: null,
        website,
        mapsUrl: place.googleMapsUri ?? null,
        rating: place.rating ?? null,
        reviewCount: place.userRatingCount ?? null,
        openingHours: place.regularOpeningHours?.weekdayDescriptions?.join('; ') ?? null,
        socialLinks: {},
        observations: {
          // The only presence fact Places can prove is whether a site is listed.
          websiteStatus: website ? undefined : 'none',
          priceLevel: place.priceLevel ? PRICE_LEVELS[place.priceLevel] : undefined,
        },
        source: 'google_places',
        isDemo: false,
        externalId: place.id ? `gplaces:${place.id}` : null,
      } satisfies DiscoveredBusiness;
    });

  return { businesses, query };
}
