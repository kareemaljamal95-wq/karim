/**
 * Query-level tests for the lead service.
 *
 * These exist because a SQL string only fails when it is actually prepared:
 * `WHERE city != ""` typechecks, builds and ships fine, then returns a 500 the
 * first time the Leads page is opened. Anything here has to touch the database.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ceo-leads-test-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_FILE = path.join(dir, 'test.db');

// Required after the environment is set, so the config module resolves the
// temporary database rather than the developer's own.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { closeDb } = require('../db') as typeof import('../db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { listLeads, leadFilterOptions, upsertLead } = require('./leads') as typeof import('./leads');

describe('lead queries run against SQLite', () => {
  before(() => {
    upsertLead({
      business: {
        name: 'Test Bakery',
        category: 'Bakeries',
        country: 'United Arab Emirates',
        city: 'Dubai',
        area: 'Al Barsha',
        source: 'demo',
        isDemo: true,
        externalId: 'test-1',
      },
    });
  });

  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('leadFilterOptions returns the distinct filter values', () => {
    const options = leadFilterOptions();
    assert.ok(Array.isArray(options.cities));
    assert.ok(options.cities.includes('Dubai'));
    assert.ok(options.categories.includes('Bakeries'));
    assert.ok(!options.cities.includes(''), 'blank cities must be filtered out');
  });

  test('listLeads runs with every filter and sort applied', () => {
    for (const sort of ['score', 'created', 'updated', 'value'] as const) {
      assert.doesNotThrow(() => listLeads({ sort, limit: 5 }));
    }
    assert.equal(listLeads({ city: 'Dubai' }).total, 1);
    assert.equal(listLeads({ city: 'Nowhere' }).total, 0);
    assert.equal(listLeads({ demoOnly: true }).total, 1);
    assert.equal(listLeads({ liveOnly: true }).total, 0);
    assert.equal(listLeads({ search: 'Bakery' }).total, 1);
    assert.equal(listLeads({ minScore: 100 }).total, 0);
  });

  test('purging demo data leaves live records untouched', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { purgeDemoData } = require('./leads') as typeof import('./leads');
    upsertLead({
      business: {
        name: 'Sample Cafe',
        category: 'Cafes',
        country: 'United Arab Emirates',
        city: 'Dubai',
        area: '',
        source: 'demo',
        isDemo: true,
        externalId: 'demo:cafe:1',
      },
    });
    const liveBefore = listLeads({ liveOnly: true }).total;
    assert.ok(listLeads({ demoOnly: true }).total > 0);

    const removed = purgeDemoData('tester');

    assert.ok(removed.leads > 0);
    assert.equal(listLeads({ demoOnly: true }).total, 0);
    assert.equal(listLeads({ liveOnly: true }).total, liveBefore, 'live records survive');
    assert.deepEqual(purgeDemoData('tester'), { leads: 0, messages: 0, approvals: 0 }, 'safe to repeat');
  });

});
