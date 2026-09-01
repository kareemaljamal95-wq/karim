import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env';

let instance: Database.Database | null = null;

function schemaPath(): string {
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    path.resolve(process.cwd(), 'src/db/schema.sql'),
    path.resolve(process.cwd(), 'server/src/db/schema.sql'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`schema.sql not found. Looked in:\n${candidates.join('\n')}`);
  return found;
}

export function db(): Database.Database {
  if (instance) return instance;
  const database = new Database(env.databaseFile);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.exec(fs.readFileSync(schemaPath(), 'utf8'));
  instance = database;
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** Runs a function inside a transaction. */
export function transaction<T>(fn: () => T): T {
  return db().transaction(fn)();
}

export const nowIso = (): string => new Date().toISOString();

/** Safe JSON parse for TEXT columns holding JSON. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const toJson = (value: unknown): string => JSON.stringify(value ?? null);

/** SQLite stores booleans as integers. */
export const bit = (value: boolean | undefined | null): number => (value ? 1 : 0);
export const unbit = (value: unknown): boolean => value === 1 || value === true;
