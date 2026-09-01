/**
 * Tests for the dispatch gate.
 *
 * Now that delivery is real, the gate is the only thing standing between a
 * draft and a stranger's inbox. Each condition is asserted separately, against
 * a real database, because a gate that is only true in review is not a gate.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ceo-messages-test-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_FILE = path.join(dir, 'test.db');
// The environment lock forces sending off regardless of settings; leave it
// unset here so the inner gates are the thing under test.
delete process.env.OUTBOUND_SENDING_LOCKED;

// Required after the environment is set, so config resolves the temp database.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { closeDb, db, nowIso } = require('../db') as typeof import('../db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const messages = require('./messages') as typeof import('./messages');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { upsertLead } = require('./leads') as typeof import('./leads');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { updateSettings } = require('./settings') as typeof import('./settings');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureIntegrationRows, updateIntegration } = require('./integrations') as typeof import('./integrations');

function draftFor(leadId: string) {
  return messages.createMessage({
    leadId,
    channel: 'email',
    subject: 'A note',
    body: 'Hello there,',
    variant: 'primary',
    isDemo: false,
  });
}

describe('the dispatch gate', () => {
  let leadId = '';

  before(() => {
    ensureIntegrationRows();
    const { lead } = upsertLead({
      business: {
        name: 'Amber Salon',
        category: 'Beauty salons',
        country: 'United Arab Emirates',
        city: 'Dubai',
        area: '',
        email: 'owner@amber.example',
        source: 'openstreetmap',
        isDemo: false,
        externalId: 'osm:node/1',
      },
    });
    leadId = lead.id;
    updateSettings({ outboundSendingEnabled: true, dailyOutreachCap: 25 });
  });

  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('refuses to send a draft that no human approved', async () => {
    const draft = draftFor(leadId);
    await assert.rejects(() => messages.sendMessage(draft.id, 'tester'), /approved message/i);
    assert.equal(messages.getMessage(draft.id).status, 'APPROVAL_REQUIRED');
  });

  test('refuses when the channel has no connected integration', async () => {
    const draft = draftFor(leadId);
    messages.markApproved(draft.id, 'tester');
    await assert.rejects(() => messages.sendMessage(draft.id, 'tester'), /no connected integration/i);
    // Still approved and queued — a blocked send is not a rejection.
    assert.equal(messages.getMessage(draft.id).status, 'APPROVED');
  });

  test('queues instead of sending when sending is switched off', async () => {
    updateSettings({ outboundSendingEnabled: false });
    const draft = draftFor(leadId);
    messages.markApproved(draft.id, 'tester');
    const result = await messages.sendMessage(draft.id, 'tester');
    assert.equal(result.dispatched, false);
    assert.match(result.reason, /disabled/i);
    assert.equal(messages.getMessage(draft.id).status, 'APPROVED');
    updateSettings({ outboundSendingEnabled: true });
  });

  test('a failed delivery leaves the message approved, never SENT', async () => {
    // Connected, but with credentials that cannot authenticate anywhere.
    updateIntegration(
      'gmail',
      { credentials: { user: 'nobody@example.invalid', appPassword: 'x'.repeat(16) }, enabled: true },
      'tester',
    );
    const draft = draftFor(leadId);
    messages.markApproved(draft.id, 'tester');

    const result = await messages.sendMessage(draft.id, 'tester');
    assert.equal(result.dispatched, false, 'delivery to an invalid host cannot succeed');
    assert.match(result.reason, /not delivered/i);
    assert.equal(
      messages.getMessage(draft.id).status,
      'APPROVED',
      'a message that did not arrive must never be recorded as sent',
    );
    assert.equal(messages.getMessage(draft.id).sentAt, null);
  });

  test('never delivers to a demo record, however it was approved', async () => {
    const { lead: demoLead } = upsertLead({
      business: {
        name: 'Sample Salon',
        category: 'Beauty salons',
        country: 'United Arab Emirates',
        city: 'Dubai',
        area: '',
        email: 'owner@sample-salon.example.com',
        source: 'demo',
        isDemo: true,
        externalId: 'demo:sample:1',
      },
    });
    const draft = messages.createMessage({
      leadId: demoLead.id,
      channel: 'email',
      subject: 'A note',
      body: 'Hello there,',
      isDemo: true,
    });
    messages.markApproved(draft.id, 'tester');

    const result = await messages.sendMessage(draft.id, 'tester');
    assert.equal(result.dispatched, false);
    assert.match(result.reason, /demo record/i);
    assert.equal(messages.getMessage(draft.id).status, 'APPROVED');
  });

  test('records a message the operator sent by hand', async () => {
    const draft = draftFor(leadId);
    await assert.rejects(
      async () => messages.markSentManually(draft.id, 'karim'),
      /approved message/i,
      'an unapproved draft cannot be marked sent either',
    );

    messages.markApproved(draft.id, 'karim');
    const sent = messages.markSentManually(draft.id, 'karim', 'sent from my own mailbox');

    assert.equal(sent.status, 'SENT');
    assert.ok(sent.sentAt);
    // The lead moves forward, so follow-ups and replies have something to attach to.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getLead } = require('./leads') as typeof import('./leads');
    assert.equal(getLead(leadId).status, 'CONTACTED');
    assert.throws(() => messages.markSentManually(draft.id, 'karim'), /already marked as sent/i);
  });

  test('stops once the daily cap is reached', async () => {
    updateSettings({ dailyOutreachCap: 1 });
    // Fill the cap with a message already delivered today. Written straight to
    // the row so the test does not depend on a real send succeeding.
    const sent = draftFor(leadId);
    db()
      .prepare(`UPDATE messages SET status = 'SENT', sent_at = @ts WHERE id = @id`)
      .run({ id: sent.id, ts: nowIso() });

    const draft = draftFor(leadId);
    messages.markApproved(draft.id, 'tester');
    const result = await messages.sendMessage(draft.id, 'tester');

    assert.equal(result.dispatched, false);
    assert.match(result.reason, /cap/i);
    assert.equal(messages.getMessage(draft.id).status, 'APPROVED');
    updateSettings({ dailyOutreachCap: 25 });
  });
});
