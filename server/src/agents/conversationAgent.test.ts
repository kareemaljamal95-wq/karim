import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before } from 'node:test';

// The agent reads its configuration from the database, so point the whole
// module graph at a throwaway file before anything is imported.
process.env.DATABASE_FILE = path.join(os.tmpdir(), `ai-ceo-test-${process.pid}-${Date.now()}.db`);
process.env.ANTHROPIC_API_KEY = '';

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../db') as typeof import('../db');
const { seedAgents } = require('./registry') as typeof import('./registry');
const { runConversationAgent } = require('./conversationAgent') as typeof import('./conversationAgent');
/* eslint-enable @typescript-eslint/no-var-requires */

const context = {
  businessName: 'Cedar Cafe',
  recommendedServiceLabel: 'Ordering system',
  lastOutboundMessage: 'We noticed you have no online ordering.',
};

before(() => {
  db();
  seedAgents();
});

describe('runConversationAgent (deterministic path, no model configured)', () => {
  it('escalates any pricing question to a human and never answers it', async () => {
    const outcome = await runConversationAgent({
      ...context,
      replyBody: 'Sounds interesting. How much would this cost us?',
    });

    assert.equal(outcome.data.requiresHuman, true);
    assert.ok(outcome.data.humanReason);
    assert.equal(outcome.validation.passed, true);
    // Whatever it suggests must contain no price of its own.
    assert.ok(!/\$\s?\d|\bAED\b|\bUSD\b/i.test(outcome.data.suggestedReply ?? ''));
  });

  it('escalates contract and timeline questions too', async () => {
    for (const reply of [
      'Can you send over the contract terms?',
      'What is the timeline — when can you go live?',
    ]) {
      const outcome = await runConversationAgent({ ...context, replyBody: reply });
      assert.equal(outcome.data.requiresHuman, true, `did not escalate: ${reply}`);
    }
  });

  it('produces no automated reply at all when the prospect opts out', async () => {
    const outcome = await runConversationAgent({
      ...context,
      replyBody: 'Please remove me from your list and do not contact us again.',
    });

    assert.equal(outcome.data.intent, 'unsubscribe');
    assert.equal(outcome.data.suggestedReply, null);
    assert.equal(outcome.data.requiresHuman, true);
    assert.equal(outcome.validation.passed, true);
  });

  it('classifies a soft decline as not interested', async () => {
    const outcome = await runConversationAgent({
      ...context,
      replyBody: 'We already work with an agency, so not right now. Thanks anyway.',
    });

    assert.equal(outcome.data.intent, 'not_interested');
    assert.equal(outcome.data.suggestedReply, null);
    assert.ok(outcome.data.objections.length > 0, 'the incumbent/timing objection should be recorded');
  });

  it('detects buying signals and a meeting request', async () => {
    const outcome = await runConversationAgent({
      ...context,
      replyBody: 'Interested — could we have a quick call next week?',
    });

    assert.equal(outcome.data.intent, 'requesting_meeting');
    assert.equal(outcome.data.sentiment, 'positive');
    assert.ok(outcome.data.buyingSignals.length > 0);
  });

  it('extracts stated requirements without inventing any', async () => {
    const outcome = await runConversationAgent({
      ...context,
      replyBody: 'I need an application for my restaurant with online ordering and delivery.',
    });

    const requirements = outcome.data.extractedRequirements.join(' ').toLowerCase();
    assert.ok(requirements.includes('delivery'));
    assert.ok(requirements.includes('ordering'));
    // Nothing about payment was said, so nothing about payment may appear.
    assert.ok(!requirements.includes('payment'));
  });

  it('marks its suggested reply as a draft that still needs approval', async () => {
    const outcome = await runConversationAgent({
      ...context,
      replyBody: 'Tell me more about what you do.',
    });

    const check = outcome.validation.checks.find((entry) => entry.name === 'reply_requires_approval');
    assert.ok(check?.passed, 'the reply must be flagged as requiring approval');
  });
});
