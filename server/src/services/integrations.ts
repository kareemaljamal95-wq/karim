import { db, nowIso, parseJson, toJson, unbit } from '../db';
import { decryptSecret, encryptSecret, maskSecret } from '../util/crypto';
import { env } from '../config/env';
import { notFound } from '../util/errors';
import { log } from './logger';

export type IntegrationKey =
  | 'google_places'
  | 'open_street_map'
  | 'website_inspection'
  | 'anthropic'
  | 'gmail'
  | 'resend'
  | 'google_sheets'
  | 'google_drive'
  | 'google_calendar'
  | 'whatsapp_business'
  | 'crm'
  | 'webhooks';

interface IntegrationCatalogEntry {
  key: IntegrationKey;
  name: string;
  category: 'discovery' | 'ai' | 'communication' | 'productivity' | 'data';
  description: string;
  /** Credential fields the integration expects. Values are write-only. */
  fields: { key: string; label: string; secret: boolean; placeholder?: string }[];
  /** Env var that can supply the primary credential instead of the database. */
  envVar?: string;
  capabilities: string[];
}

export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  {
    key: 'google_places',
    name: 'Google Places / Maps',
    category: 'discovery',
    description:
      'Official source for business discovery. When connected, the Market Scout queries live Places data instead of demo fixtures.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true, placeholder: 'AIza...' }],
    envVar: 'GOOGLE_PLACES_API_KEY',
    capabilities: ['Business search by city/area/category', 'Ratings, reviews, hours, website'],
  },
  {
    key: 'open_street_map',
    name: 'OpenStreetMap',
    category: 'discovery',
    description:
      'Keyless alternative to Google Places, for operators who cannot obtain a Places key. Discovers real businesses through Nominatim and Overpass — no API key, no billing account. Carries phone, website, hours and published email addresses, but no ratings or review counts, so leads from it produce fewer signals.',
    fields: [],
    capabilities: ['Business search by city/area/category', 'Phone, website, email, opening hours'],
  },
  {
    key: 'website_inspection',
    name: 'Website verification',
    category: 'discovery',
    description:
      "Visits each lead's own website and reports what is actually there — booking, ordering, chat, social profiles, a published email. Turns unknowns into observed evidence, which is what discovery sources cannot supply. No key needed; the platform fetches public pages only.",
    fields: [],
    capabilities: ['Booking / ordering / chat detection', 'Social profiles and public email', 'Dead-link detection'],
  },
  {
    key: 'anthropic',
    name: 'Anthropic (Claude)',
    category: 'ai',
    description:
      'Powers agent reasoning. Without it the platform falls back to a deterministic rule engine, which is clearly labelled in every result.',
    fields: [{ key: 'apiKey', label: 'API key', secret: true, placeholder: 'sk-ant-...' }],
    envVar: 'ANTHROPIC_API_KEY',
    capabilities: ['Opportunity analysis', 'Service strategy', 'Outreach drafting', 'Reply analysis'],
  },
  {
    key: 'gmail',
    name: 'Email (SMTP)',
    category: 'communication',
    description:
      'Email delivery over SMTP. Works with Gmail — where the password must be a 16-character App Password with 2-step verification on — or with any provider that gives you a mailbox on your own domain. Leave the host and port blank for Gmail. Connecting it does not start sending: a message still needs human approval, the environment switch and the Settings toggle.',
    fields: [
      { key: 'user', label: 'Sending address', secret: false, placeholder: 'you@yourdomain.com' },
      { key: 'appPassword', label: 'Password or App Password', secret: true },
      { key: 'host', label: 'SMTP host (blank for Gmail)', secret: false, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'SMTP port (blank for 465)', secret: false, placeholder: '465' },
    ],
    capabilities: ['Send approved outreach', 'Works with your own domain', 'Replies arrive in the mailbox itself'],
  },
  {
    key: 'resend',
    name: 'Resend (email API)',
    category: 'communication',
    description:
      'Email delivery over HTTPS instead of SMTP — the way to send from a host that blocks SMTP ports, which most platforms do on their lower plans. Needs an API key and a sending address on a domain verified with Resend. Preferred over the SMTP connector when both are on.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true, placeholder: 're_...' },
      { key: 'from', label: 'Sending address', secret: false, placeholder: 'you@yourdomain.com' },
    ],
    capabilities: ['Send approved outreach over HTTPS', 'Works where SMTP is blocked', 'Sends from your own domain'],
  },
  {
    key: 'whatsapp_business',
    name: 'WhatsApp Business API',
    category: 'communication',
    description: 'WhatsApp channel for approved messages and inbound reply handling.',
    fields: [
      { key: 'phoneNumberId', label: 'Phone number ID', secret: false },
      { key: 'accessToken', label: 'Access token', secret: true },
    ],
    capabilities: ['Send approved templates', 'Receive replies'],
  },
  {
    key: 'google_sheets',
    name: 'Google Sheets',
    category: 'productivity',
    description: 'Export the lead database to a spreadsheet for offline review.',
    fields: [{ key: 'serviceAccountJson', label: 'Service account JSON', secret: true }],
    capabilities: ['Lead export', 'Pipeline snapshots'],
  },
  {
    key: 'google_drive',
    name: 'Google Drive',
    category: 'productivity',
    description: 'Store generated proposals and deliverables.',
    fields: [{ key: 'serviceAccountJson', label: 'Service account JSON', secret: true }],
    capabilities: ['Proposal storage'],
  },
  {
    key: 'google_calendar',
    name: 'Google Calendar',
    category: 'productivity',
    description: 'Book scoping calls when a prospect shows intent.',
    fields: [{ key: 'serviceAccountJson', label: 'Service account JSON', secret: true }],
    capabilities: ['Meeting scheduling'],
  },
  {
    key: 'crm',
    name: 'External CRM',
    category: 'data',
    description: 'Two-way sync of leads and deal stages with an external CRM.',
    fields: [
      { key: 'baseUrl', label: 'Base URL', secret: false },
      { key: 'apiKey', label: 'API key', secret: true },
    ],
    capabilities: ['Lead sync', 'Stage sync'],
  },
  {
    key: 'webhooks',
    name: 'Outbound webhooks',
    category: 'data',
    description: 'Notify an external system whenever an approval, reply or won deal occurs.',
    fields: [
      { key: 'url', label: 'Endpoint URL', secret: false },
      { key: 'signingSecret', label: 'Signing secret', secret: true },
    ],
    capabilities: ['Event notifications'],
  },
];

export interface IntegrationView {
  key: IntegrationKey;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  fields: { key: string; label: string; secret: boolean; placeholder?: string }[];
  enabled: boolean;
  configured: boolean;
  /** Whether the credential comes from an environment variable rather than the DB. */
  fromEnv: boolean;
  /** Masked hints only — full secrets are never returned by the API. */
  credentialHints: Record<string, string>;
  config: Record<string, unknown>;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

function envCredential(entry: IntegrationCatalogEntry): string | null {
  if (entry.key === 'google_places' && env.googlePlacesApiKey) return env.googlePlacesApiKey;
  if (entry.key === 'anthropic' && env.anthropicApiKey) return env.anthropicApiKey;
  return null;
}

export function ensureIntegrationRows(): void {
  const insert = db().prepare(
    `INSERT INTO integrations (key, name, category, description, enabled, credentials, config, updated_at)
     VALUES (@key, @name, @category, @description, 0, NULL, '{}', @updated_at)
     ON CONFLICT(key) DO UPDATE SET name = @name, category = @category, description = @description`,
  );
  const now = nowIso();
  for (const entry of INTEGRATION_CATALOG) {
    insert.run({
      key: entry.key,
      name: entry.name,
      category: entry.category,
      description: entry.description,
      updated_at: now,
    });
  }
}

function readRow(key: IntegrationKey): Record<string, unknown> | undefined {
  return db().prepare('SELECT * FROM integrations WHERE key = ?').get(key) as
    | Record<string, unknown>
    | undefined;
}

/** Returns decrypted credentials. Server-side only — never send to a client. */
export function getCredentials(key: IntegrationKey): Record<string, string> {
  const entry = INTEGRATION_CATALOG.find((i) => i.key === key);
  if (!entry) throw notFound(`Unknown integration "${key}"`);

  const row = readRow(key);
  let stored: Record<string, string> = {};
  if (row?.credentials) {
    try {
      stored = parseJson<Record<string, string>>(decryptSecret(String(row.credentials)), {});
    } catch {
      stored = {};
    }
  }

  const fromEnv = envCredential(entry);
  if (fromEnv && !stored.apiKey) stored.apiKey = fromEnv;
  return stored;
}

export function isConfigured(key: IntegrationKey): boolean {
  const entry = INTEGRATION_CATALOG.find((i) => i.key === key);
  if (!entry) return false;
  const creds = getCredentials(key);
  const requiredSecrets = entry.fields.filter((f) => f.secret).map((f) => f.key);
  // A connector with no secrets to supply (OpenStreetMap) needs nothing but the
  // admin's decision to switch it on, which `isActive` checks separately.
  if (requiredSecrets.length === 0) return true;
  return requiredSecrets.every((f) => Boolean(creds[f]));
}

/** Configured AND switched on by an admin. */
export function isActive(key: IntegrationKey): boolean {
  const row = readRow(key);
  const enabled = row ? unbit(row.enabled) : false;
  // Env-provided credentials are considered explicitly enabled by the operator
  // who set them, so an env key alone is enough to activate the integration.
  const entry = INTEGRATION_CATALOG.find((i) => i.key === key);
  const envEnabled = entry ? Boolean(envCredential(entry)) : false;
  return isConfigured(key) && (enabled || envEnabled);
}

export function listIntegrations(): IntegrationView[] {
  ensureIntegrationRows();
  return INTEGRATION_CATALOG.map((entry) => {
    const row = readRow(entry.key);
    const creds = getCredentials(entry.key);
    const hints: Record<string, string> = {};
    for (const field of entry.fields) {
      if (creds[field.key]) {
        hints[field.key] = field.secret ? maskSecret(creds[field.key]) : creds[field.key];
      }
    }
    return {
      key: entry.key,
      name: entry.name,
      category: entry.category,
      description: entry.description,
      capabilities: entry.capabilities,
      fields: entry.fields,
      enabled: isActive(entry.key),
      configured: isConfigured(entry.key),
      fromEnv: Boolean(envCredential(entry)),
      credentialHints: hints,
      config: parseJson<Record<string, unknown>>(row?.config, {}),
      lastCheckedAt: (row?.last_checked_at as string) ?? null,
      lastError: (row?.last_error as string) ?? null,
      updatedAt: (row?.updated_at as string) ?? null,
    };
  });
}

export function updateIntegration(
  key: IntegrationKey,
  patch: { credentials?: Record<string, string>; config?: Record<string, unknown>; enabled?: boolean },
  actor: string,
): IntegrationView {
  const entry = INTEGRATION_CATALOG.find((i) => i.key === key);
  if (!entry) throw notFound(`Unknown integration "${key}"`);
  ensureIntegrationRows();

  const existing = getCredentials(key);
  // Blank values mean "leave unchanged" so the UI never has to echo a secret back.
  const merged = { ...existing };
  for (const [field, value] of Object.entries(patch.credentials ?? {})) {
    if (value === '') delete merged[field];
    else if (value !== undefined) merged[field] = value;
  }

  db()
    .prepare(
      `UPDATE integrations SET
         credentials = @credentials,
         config = COALESCE(@config, config),
         enabled = COALESCE(@enabled, enabled),
         updated_at = @updated_at
       WHERE key = @key`,
    )
    .run({
      key,
      credentials: Object.keys(merged).length ? encryptSecret(toJson(merged)) : null,
      config: patch.config ? toJson(patch.config) : null,
      enabled: patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
      updated_at: nowIso(),
    });

  log({
    actorType: 'user',
    actor,
    action: 'integration.updated',
    entityType: 'integration',
    entityId: key,
    message: `Integration "${entry.name}" updated`,
    meta: {
      enabled: patch.enabled,
      credentialFieldsChanged: Object.keys(patch.credentials ?? {}),
    },
  });

  return listIntegrations().find((i) => i.key === key)!;
}

export function recordIntegrationCheck(key: IntegrationKey, error: string | null): void {
  db()
    .prepare('UPDATE integrations SET last_checked_at = @ts, last_error = @error WHERE key = @key')
    .run({ key, ts: nowIso(), error });
}
