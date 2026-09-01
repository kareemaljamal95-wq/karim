/**
 * Tests for bulk website verification.
 *
 * The value of this run is reach, so what matters is which leads it picks: it
 * must skip the ones already reachable, refuse demo records outright, and never
 * abandon the batch because one business's site is down.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ceo-batch-verify-test-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_FILE = path.join(dir, 'test.db');

// Required after the environment is set, so config resolves the temp database.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { closeDb } = require('../db') as typeof import('../db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { seedAgents } = require('../agents/registry') as typeof import('../agents/registry');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureIntegrationRows, updateIntegration } =
  require('../services/integrations') as typeof import('../services/integrations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { upsertLead } = require('../services/leads') as typeof import('../services/leads');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verifyLeadWebsites } = require('./verifyLeadBatch') as typeof import('./verifyLeadBatch');

function lead(over: Record<string, unknown>) {
  return upsertLead({
    business: {
      name: 'Business',
      category: 'Cafe',
      country: 'Germany',
      city: 'Berlin',
      area: '',
      source: 'openstreetmap',
      isDemo: false,
      ...over,
    } as Parameters<typeof upsertLead>[0]['business'],
  }).lead;
}

describe('bulk website verification', () => {
  before(() => {
    seedAgents();
    ensureIntegrationRows();
    updateIntegration('website_inspection', { enabled: true }, 'tester');
  });

  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('picks only leads that have a website and no email', async () => {
    lead({ name: 'Has both', externalId: 'a', website: 'https://a.invalid/', email: 'a@a.example' });
    lead({ name: 'No website', externalId: 'b' });
    lead({ name: 'Worth visiting', externalId: 'c', website: 'https://c.invalid/' });
    lead({ name: 'Demo record', externalId: 'd', website: 'https://d.invalid/', isDemo: true });

    const result = await verifyLeadWebsites({ missingContactOnly: true }, 'karim');

    assert.equal(
      result.candidates,
      1,
      'a lead that already has an email, one with no site, and a demo record are all skipped',
    );
  });

  test('an unreachable site is recorded, not thrown', async () => {
    // .invalid never resolves, so every candidate here fails to load. The run
    // has to survive that — one dead site is a fact about one business.
    const result = await verifyLeadWebsites({ missingContactOnly: true }, 'karim');

    assert.equal(result.emailsFound, 0);
    assert.equal(result.inspected + result.failures.length, result.candidates);
  });

  test('refuses to run when the connector is switched off', async () => {
    updateIntegration('website_inspection', { enabled: false }, 'tester');
    await assert.rejects(() => verifyLeadWebsites({}, 'karim'), /not enabled/i);
    updateIntegration('website_inspection', { enabled: true }, 'tester');
  });
});
