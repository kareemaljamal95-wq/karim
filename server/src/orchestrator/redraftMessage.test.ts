/**
 * Tests for re-drafting a saved message.
 *
 * The thing worth guarding is not the rewrite itself but what it does to the
 * gate: new wording nobody has read must never inherit an old approval.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ceo-redraft-test-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_FILE = path.join(dir, 'test.db');

// Required after the environment is set, so config resolves the temp database.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { closeDb } = require('../db') as typeof import('../db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { seedAgents } = require('../agents/registry') as typeof import('../agents/registry');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const messages = require('../services/messages') as typeof import('../services/messages');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { upsertLead } = require('../services/leads') as typeof import('../services/leads');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { redraftMessage } = require('./redraftMessage') as typeof import('./redraftMessage');

describe('re-drafting a message', () => {
  let leadId = '';

  before(() => {
    seedAgents();
    const { lead } = upsertLead({
      business: {
        name: 'Schoenes Cafe',
        category: 'Cafe',
        country: 'Germany',
        city: 'Berlin',
        area: 'Kreuzberg',
        email: 'hello@example.com',
        website: 'https://example.com/',
        source: 'openstreetmap',
        isDemo: false,
        externalId: 'osm:node/1',
      },
    });
    leadId = lead.id;
  });

  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const draft = () =>
    messages.createMessage({
      leadId,
      channel: 'email',
      subject: 'Stale subject',
      body: 'Wording written by an older version of the outreach agent.',
      isDemo: false,
    });

  test('replaces stale copy with what the agent writes now', async () => {
    const message = draft();
    const result = await redraftMessage(message.id, 'karim');

    assert.equal(result.changed, true);
    assert.notEqual(result.message.body, message.body);
    assert.equal(result.previousBody, message.body);
    // The business is named in the new copy, so this is a real draft about this
    // lead rather than a placeholder.
    assert.match(result.message.body, /Schoenes Cafe/);
  });

  test('a re-drafted message goes back to the approval queue', async () => {
    const message = draft();
    messages.markApproved(message.id, 'karim');
    assert.equal(messages.getMessage(message.id).status, 'APPROVED');

    await redraftMessage(message.id, 'karim');

    assert.equal(
      messages.getMessage(message.id).status,
      'APPROVAL_REQUIRED',
      'nobody has read the new wording, so the old approval cannot carry over',
    );
  });

  test('re-drafting twice changes nothing the second time', async () => {
    const message = draft();
    await redraftMessage(message.id, 'karim');
    const second = await redraftMessage(message.id, 'karim');

    assert.equal(second.changed, false, 'the same analysis must produce the same draft');
  });

  test('refuses to rewrite a message that was already sent', async () => {
    const message = draft();
    messages.markApproved(message.id, 'karim');
    messages.markSentManually(message.id, 'karim');

    await assert.rejects(() => redraftMessage(message.id, 'karim'), /already been sent/i);
    assert.equal(messages.getMessage(message.id).status, 'SENT');
  });
});
