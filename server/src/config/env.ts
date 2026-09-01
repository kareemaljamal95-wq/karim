import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// Load .env from the repo root and from server/ (server/ wins).
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const isProduction = process.env.NODE_ENV === 'production';

/**
 * All secrets are read server-side only. Nothing in this module is ever
 * serialised to the frontend; `GET /api/integrations` reports configured
 * state only, never values.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction,
  port: Number(process.env.PORT ?? 4000),
  dataDir,
  databaseFile: process.env.DATABASE_FILE ?? path.join(dataDir, 'ai-ceo.db'),

  // Auth
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-insecure-jwt-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  /** Key used to encrypt integration credentials at rest (AES-256-GCM). */
  appSecret: process.env.APP_SECRET ?? 'dev-only-insecure-app-secret-change-me',

  // Bootstrap admin (created on first run only)
  bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@ai-ceo.local',
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'ChangeMe!2024',
  /**
   * Break-glass recovery. When set, the admin password is reset to this value
   * on boot. It grants nothing new: anyone able to set a variable on the
   * service can already read APP_SECRET, JWT_SECRET and the database file.
   * It exists because the alternative to a forgotten password was deleting the
   * volume — which takes every lead and message with it.
   */
  adminPasswordReset: process.env.ADMIN_PASSWORD_RESET ?? '',

  // LLM
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
  llmEffort: (process.env.LLM_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',

  // Discovery
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY ?? '',

  // Behaviour
  /** Demo mode is forced on whenever no live data source is configured. */
  demoMode: bool(process.env.DEMO_MODE, true),
  /**
   * Seeds the labelled demo dataset on boot, but only while the lead table is
   * empty. Exists for deployments, where there is no shell to run `npm run
   * seed` from. Seeded records are flagged as demo data like any other.
   */
  seedDemoData: bool(process.env.SEED_DEMO_DATA, false),
  /**
   * Master kill-switch for outbound messaging. The MVP ships with sending
   * disabled: every message must pass through human approval, and even an
   * approved message is only dispatched when a channel integration is
   * connected AND this flag is explicitly enabled.
   */
  /**
   * Hard lock on outbound sending, for deployments where the person running the
   * infrastructure is not the person running the business. Set it and no
   * setting can turn sending on. Left unset — the normal case, where the owner
   * is the operator — the Settings toggle decides, because an owner who cannot
   * reach the hosting dashboard would otherwise be locked out of their own
   * platform with no way back in.
   *
   * This replaces OUTBOUND_SENDING_ENABLED, which required the variable AND the
   * setting and so made the hosting dashboard a second, invisible switch.
   */
  outboundSendingLocked: bool(process.env.OUTBOUND_SENDING_LOCKED, false),

  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  /**
   * Public marketing domain. When a request arrives on it, the root path serves
   * the landing page instead of the dashboard, so one deployment can answer on
   * both names.
   */
  marketingDomain: (process.env.MARKETING_DOMAIN ?? '').trim().toLowerCase(),
} as const;

export function assertProductionSecrets(): string[] {
  const warnings: string[] = [];
  if (!isProduction) return warnings;
  if (env.jwtSecret.startsWith('dev-only')) warnings.push('JWT_SECRET is not set.');
  if (env.appSecret.startsWith('dev-only')) warnings.push('APP_SECRET is not set.');
  if (env.bootstrapAdminPassword === 'ChangeMe!2024') {
    warnings.push('BOOTSTRAP_ADMIN_PASSWORD is still the default.');
  }
  if (env.adminPasswordReset) {
    warnings.push(
      'ADMIN_PASSWORD_RESET is still set. Remove it once you have signed in — ' +
        'while it is set, that password is the admin password.',
    );
  }
  return warnings;
}
