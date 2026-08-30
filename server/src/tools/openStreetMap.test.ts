/**
 * Tests for the OpenStreetMap adapter's pure parts: which tags a category maps
 * to, and how a raw Overpass element becomes a lead. The network calls are not
 * exercised here — what matters is that the mapping never invents a fact.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxWithin,
  mapOsmElement,
  osmSelectorsFor,
  overpassQuery,
  padBox,
  parseBox,
  type OsmElement,
} from './openStreetMap';

const params = { country: 'Saudi Arabia', city: 'Riyadh', area: 'Al Olaya', category: 'Restaurants' };

describe('category to OSM tag mapping', () => {
  test('keyword matches beat the family fallback', () => {
    assert.deepEqual(osmSelectorsFor('Dental clinics'), ['amenity=dentist', 'healthcare=dentist']);
    assert.deepEqual(osmSelectorsFor('Car workshops'), ['shop=car_repair']);
    assert.deepEqual(osmSelectorsFor('Real estate offices'), ['office=estate_agent']);
    assert.ok(osmSelectorsFor('Beauty salons').includes('shop=beauty'));
  });

  test('an unrecognised category still resolves through its family', () => {
    const selectors = osmSelectorsFor('Shawarma joints');
    assert.ok(selectors.length > 0);
    assert.ok(selectors.includes('amenity=restaurant'));
  });

  test('every selector is a key=value pair the query builder can use', () => {
    for (const category of ['Restaurants', 'Hotels', 'Something unheard of']) {
      for (const selector of osmSelectorsFor(category)) {
        assert.match(selector, /^[a-z_]+=[a-z_]+$/);
      }
    }
  });

  test('the query asks only for named features inside the box', () => {
    const query = overpassQuery(
      ['amenity=restaurant'],
      { south: 24.6, north: 24.8, west: 46.6, east: 46.8, label: 'Riyadh' },
      10,
    );
    assert.match(query, /\[out:json\]\[timeout:25\]/);
    assert.match(query, /nwr\["amenity"="restaurant"\]\["name"\]\(24\.6,46\.6,24\.8,46\.8\);/);
    assert.match(query, /out center 10;/);
  });
});

describe('resolving the search area', () => {
  // Riyadh, and the real Al Olaya district inside it.
  const riyadh = parseBox({
    boundingbox: ['24.4', '25.1', '46.4', '47.1'],
    display_name: 'Riyadh, Saudi Arabia',
  });
  const alOlaya = parseBox({ boundingbox: ['24.68', '24.72', '46.66', '46.70'] });
  // A same-named neighbourhood in another governorate, ~200km west.
  const wrongOlaya = parseBox({ boundingbox: ['23.74', '23.78', '44.73', '44.77'] });

  test('parses a Nominatim box and rejects an unusable one', () => {
    assert.deepEqual(riyadh, { south: 24.4, north: 25.1, west: 46.4, east: 47.1, label: 'Riyadh, Saudi Arabia' });
    assert.equal(parseBox({}), null);
    assert.equal(parseBox({ boundingbox: ['x', '1', '2', '3'] }), null);
  });

  test('accepts an area inside the city and rejects a same-named one outside it', () => {
    assert.ok(riyadh && alOlaya && wrongOlaya);
    assert.equal(boxWithin(riyadh, alOlaya), true);
    assert.equal(boxWithin(riyadh, wrongOlaya), false);
  });

  test('grows a point-sized district to a searchable area, without leaving the city', () => {
    assert.ok(riyadh);
    // Nominatim gives some districts a box a few hundred metres across.
    const pinpoint = { south: 24.6678, north: 24.6701, west: 46.698, east: 46.701, label: 'Al Olaya' };
    const padded = padBox(pinpoint, 0.02, riyadh);
    assert.ok(padded.north - padded.south >= 0.019, 'latitude span grew');
    assert.ok(padded.east - padded.west >= 0.019, 'longitude span grew');
    assert.ok(boxWithin(riyadh, padded), 'still inside the city');

    // An already-large area keeps its extent (recomputing from the centre can
    // shift a bound by a float ulp, which is why this is not a deep-equal).
    const big = { south: 24.5, north: 24.7, west: 46.6, east: 46.8, label: 'big' };
    const kept = padBox(big, 0.02, riyadh);
    for (const edge of ['south', 'north', 'west', 'east'] as const) {
      assert.ok(Math.abs(kept[edge] - big[edge]) < 1e-9, `${edge} unchanged`);
    }
  });

  test('padding is clamped to the city near its edge', () => {
    assert.ok(riyadh);
    const edge = { south: 24.402, north: 24.403, west: 46.402, east: 46.403, label: 'edge' };
    const padded = padBox(edge, 0.05, riyadh);
    assert.ok(padded.south >= riyadh.south && padded.west >= riyadh.west);
  });
});

describe('mapping an Overpass element to a lead', () => {
  const element: OsmElement = {
    type: 'node',
    id: 42,
    tags: {
      name: 'Cedar Grill',
      amenity: 'restaurant',
      phone: '+966 11 000 0000',
      'contact:email': 'hello@cedargrill.example',
      website: 'https://cedargrill.example',
      opening_hours: 'Sa-Th 12:00-23:00',
      'addr:housenumber': '12',
      'addr:street': 'King Fahd Road',
      'addr:city': 'Riyadh',
      'contact:instagram': 'cedargrill',
    },
  };

  test('passes through only what the tags actually contain', () => {
    const business = mapOsmElement(element, params);
    assert.ok(business);
    assert.equal(business.name, 'Cedar Grill');
    assert.equal(business.category, 'Restaurant');
    assert.equal(business.phone, '+966 11 000 0000');
    assert.equal(business.email, 'hello@cedargrill.example');
    assert.equal(business.website, 'https://cedargrill.example');
    assert.equal(business.address, '12 King Fahd Road, Riyadh');
    assert.equal(business.socialLinks?.instagram, 'cedargrill');
    assert.equal(business.externalId, 'osm:node/42');
    assert.equal(business.source, 'openstreetmap');
    assert.equal(business.isDemo, false);
  });

  test('leaves ratings unknown rather than zero — OSM has no rating system', () => {
    const business = mapOsmElement(element, params);
    assert.equal(business?.rating, null);
    assert.equal(business?.reviewCount, null);
  });

  test('a missing website tag is unknown, never evidence of no website', () => {
    const bare: OsmElement = { type: 'way', id: 7, tags: { name: 'Quiet Cafe', amenity: 'cafe' } };
    const business = mapOsmElement(bare, params);
    assert.ok(business);
    assert.equal(business.website, null);
    // The Places adapter can set websiteStatus 'none' because Places lists every
    // known site. Volunteer map data cannot prove absence, so nothing is claimed.
    assert.equal(business.observations?.websiteStatus, undefined);
    assert.deepEqual(business.observations, {});
  });

  test('skips features that cannot be leads', () => {
    assert.equal(mapOsmElement({ type: 'node', id: 1, tags: { amenity: 'restaurant' } }, params), null);
    assert.equal(
      mapOsmElement({ type: 'node', id: 2, tags: { name: 'Old Shop', 'disused:shop': 'bakery' } }, params),
      null,
    );
  });

  test('prefers the address city over the searched city when tagged', () => {
    const other: OsmElement = {
      type: 'node',
      id: 9,
      tags: { name: 'Suburb Salon', shop: 'beauty', 'addr:city': 'Diriyah' },
    };
    assert.equal(mapOsmElement(other, params)?.city, 'Diriyah');
    assert.equal(mapOsmElement({ type: 'node', id: 10, tags: { name: 'X', shop: 'beauty' } }, params)?.city, 'Riyadh');
  });
});
