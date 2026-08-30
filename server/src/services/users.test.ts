/**
 * Tests for break-glass admin recovery.
 *
 * This path only ever runs when someone is already locked out, which is the
 * worst possible moment to discover it is broken — so it is asserted against a
 * real database, including the cases where it must refuse to act.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ceo-users-test-'));
process.env.DATA_DIR = dir;
process.env.DATABASE_FILE = path.join(dir, 'test.db');
process.env.BOOTSTRAP_ADMIN_EMAIL = 'owner@example.com';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'first-password';

// Required after the environment is set, so config resolves the temp database.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { closeDb, db } = require('../db') as typeof import('../db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const users = require('./users') as typeof import('./users');

describe('break-glass admin recovery', () => {
  let adminId = '';

  before(() => {
    const admin = users.ensureBootstrapAdmin();
    assert.ok(admin, 'bootstrap admin should be created on an empty database');
    adminId = admin.id;
    // A second account that must never be the one recovered.
    users.createUser({
      email: 'analyst@example.com',
      name: 'Analyst',
      password: 'analyst-password',
      role: 'analyst',
    });
  });

  after(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('does nothing when no reset password is configured', () => {
    assert.equal(users.applyAdminPasswordReset(''), null);
    assert.doesNotThrow(() => users.verifyCredentials('owner@example.com', 'first-password'));
  });

  test('refuses a password too short to be worth setting', () => {
    assert.throws(() => users.applyAdminPasswordReset('short'), /at least 8 characters/i);
    assert.doesNotThrow(() => users.verifyCredentials('owner@example.com', 'first-password'));
  });

  test('resets the admin password and leaves other accounts alone', () => {
    const recovered = users.applyAdminPasswordReset('recovered-password');

    assert.equal(recovered?.id, adminId);
    assert.equal(recovered?.email, 'owner@example.com');
    assert.doesNotThrow(() => users.verifyCredentials('owner@example.com', 'recovered-password'));
    assert.throws(() => users.verifyCredentials('owner@example.com', 'first-password'));
    // The analyst is untouched: recovery is not a way to take over any account.
    assert.doesNotThrow(() => users.verifyCredentials('analyst@example.com', 'analyst-password'));
  });

  test('a restart with the variable still set changes nothing', () => {
    // The second call is the one that would fire on every redeploy. If it were
    // to rewrite the row, a password changed in Settings would be silently
    // reverted on the next restart.
    assert.equal(users.applyAdminPasswordReset('recovered-password'), null);
    assert.doesNotThrow(() => users.verifyCredentials('owner@example.com', 'recovered-password'));
  });

  test('recovers an admin who was locked out by being disabled', () => {
    users.updateUser(adminId, { active: false });
    assert.throws(() => users.verifyCredentials('owner@example.com', 'recovered-password'), /disabled/i);

    users.applyAdminPasswordReset('back-in-again');

    assert.doesNotThrow(() => users.verifyCredentials('owner@example.com', 'back-in-again'));
  });

  test('does nothing when the platform has no admin at all', () => {
    db().prepare("DELETE FROM users WHERE role = 'admin'").run();
    assert.equal(users.applyAdminPasswordReset('another-password'), null);
  });
});
