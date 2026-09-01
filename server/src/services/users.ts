import bcrypt from 'bcryptjs';
import { db, nowIso, unbit } from '../db';
import { newId } from '../util/crypto';
import { badRequest, conflict, notFound, unauthorized } from '../util/errors';
import { env } from '../config/env';
import type { AuthUser, Role } from '../types';
import { ROLES } from '../types';

export interface UserRecord extends AuthUser {
  active: boolean;
  createdAt: string;
}

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role as Role,
    active: unbit(row.active),
    createdAt: String(row.created_at),
  };
}

export function listUsers(): UserRecord[] {
  const rows = db().prepare('SELECT * FROM users ORDER BY created_at ASC').all() as Record<
    string,
    unknown
  >[];
  return rows.map(mapUser);
}

export function findUserById(id: string): UserRecord | null {
  const row = db().prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUser(row) : null;
}

export function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: Role;
}): UserRecord {
  if (!ROLES.includes(input.role)) throw badRequest(`Unknown role "${input.role}"`);
  if (input.password.length < 8) throw badRequest('Password must be at least 8 characters');

  const email = input.email.trim().toLowerCase();
  const existing = db().prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) throw conflict('A user with that email already exists');

  const now = nowIso();
  const record = {
    id: newId(),
    email,
    name: input.name.trim(),
    password_hash: bcrypt.hashSync(input.password, 10),
    role: input.role,
    active: 1,
    created_at: now,
    updated_at: now,
  };
  db()
    .prepare(
      `INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
       VALUES (@id, @email, @name, @password_hash, @role, @active, @created_at, @updated_at)`,
    )
    .run(record);
  return mapUser(record);
}

export function updateUser(
  id: string,
  patch: { name?: string; role?: Role; active?: boolean; password?: string },
): UserRecord {
  const user = findUserById(id);
  if (!user) throw notFound('User not found');
  if (patch.role && !ROLES.includes(patch.role)) throw badRequest(`Unknown role "${patch.role}"`);
  if (patch.password && patch.password.length < 8) {
    throw badRequest('Password must be at least 8 characters');
  }

  db()
    .prepare(
      `UPDATE users SET
         name = COALESCE(@name, name),
         role = COALESCE(@role, role),
         active = COALESCE(@active, active),
         password_hash = COALESCE(@password_hash, password_hash),
         updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      name: patch.name ?? null,
      role: patch.role ?? null,
      active: patch.active === undefined ? null : patch.active ? 1 : 0,
      password_hash: patch.password ? bcrypt.hashSync(patch.password, 10) : null,
      updated_at: nowIso(),
    });

  return findUserById(id)!;
}

export function verifyCredentials(email: string, password: string): UserRecord {
  const row = db()
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as Record<string, unknown> | undefined;
  if (!row) throw unauthorized('Invalid email or password');
  if (!unbit(row.active)) throw unauthorized('This account is disabled');
  if (!bcrypt.compareSync(password, String(row.password_hash))) {
    throw unauthorized('Invalid email or password');
  }
  return mapUser(row);
}

/**
 * Break-glass password recovery, applied on boot when `ADMIN_PASSWORD_RESET`
 * is set.
 *
 * There is no "forgot password" email on a platform that may have no mail
 * channel connected yet, so without this the only way back into a locked
 * account is deleting the volume — which destroys every lead, message and
 * approval along with it.
 *
 * Deliberately narrow:
 * - only an admin account is ever touched, never an operator or analyst;
 * - a restart with the variable still set is a no-op, because the password is
 *   already the requested one, so it cannot silently undo a later change;
 * - a too-short value is refused rather than weakening the account.
 *
 * Returns the account whose password changed, or null when nothing was done.
 */
export function applyAdminPasswordReset(
  password: string = env.adminPasswordReset,
): UserRecord | null {
  if (!password) return null;
  if (password.length < 8) {
    throw badRequest('ADMIN_PASSWORD_RESET must be at least 8 characters');
  }

  const target = (db()
    .prepare(
      `SELECT * FROM users WHERE role = 'admin'
       ORDER BY (email = ?) DESC, created_at ASC LIMIT 1`,
    )
    .get(env.bootstrapAdminEmail.trim().toLowerCase()) ?? undefined) as
    | Record<string, unknown>
    | undefined;
  if (!target) return null;

  // Already the requested password: every restart after the first lands here,
  // so leaving the variable set does not keep rewriting the account.
  if (bcrypt.compareSync(password, String(target.password_hash))) return null;

  db()
    .prepare(
      `UPDATE users SET password_hash = @password_hash, active = 1, updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id: String(target.id),
      password_hash: bcrypt.hashSync(password, 10),
      updated_at: nowIso(),
    });

  return findUserById(String(target.id));
}

/** Creates the bootstrap admin the first time the platform starts. */
export function ensureBootstrapAdmin(): UserRecord | null {
  const count = db().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (count.c > 0) return null;
  return createUser({
    email: env.bootstrapAdminEmail,
    name: 'Platform Admin',
    password: env.bootstrapAdminPassword,
    role: 'admin',
  });
}
