import crypto from 'node:crypto';
import { env } from '../config/env';

const ALGO = 'aes-256-gcm';

function key(): Buffer {
  return crypto.createHash('sha256').update(env.appSecret).digest();
}

/** Encrypts a credential for storage at rest. Format: v1.iv.tag.ciphertext (base64url). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Masks a secret for display: never returns more than the last 4 characters. */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `••••••••${value.slice(-4)}`;
}

export const newId = (): string => crypto.randomUUID();
