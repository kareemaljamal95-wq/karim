/**
 * Tests for who controls outbound sending.
 *
 * Sending used to require an environment variable AND the Settings toggle, which
 * made the hosting dashboard a second, invisible switch: an owner who could not
 * reach it could never turn sending on in their own platform. The setting now
 * decides, and the environment only gets a vote when someone deliberately locks
 * the deployment down.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ceo-settings-test-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_FILE = path.join(dir, 'test.db');
delete process.env.OUTBOUND_SENDING_LOCKED;

// Required after the environment is set, so config resolves the temp database.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { closeDb } = require('../db') as typeof import('../db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSettings, updateSettings } = require('./settings') as typeof import('./settings');

describe('the outbound sending switch', () => {
  before(() => {
    updateSettings({ outboundSendingEnabled: false });
  });

  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('is off until it is switched on', () => {
    assert.equal(getSettings().outboundSendingEnabled, false);
  });

  test('the owner can switch it on from the platform alone', () => {
    updateSettings({ outboundSendingEnabled: true });
    assert.equal(
      getSettings().outboundSendingEnabled,
      true,
      'no environment variable should be needed to enable sending',
    );
  });

  test('first contact always needs a human, whatever is stored', () => {
    // The one setting the operator is not allowed to turn off.
    const saved = updateSettings({ requireApprovalForFirstContact: false });
    assert.equal(saved.requireApprovalForFirstContact, true);
    assert.equal(getSettings().requireApprovalForFirstContact, true);
  });
});
