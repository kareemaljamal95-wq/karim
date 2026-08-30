import { db, nowIso, parseJson, toJson } from '../db';
import { env } from '../config/env';

export interface PlatformSettings {
  /** Company identity used by the outreach agent so it never invents one. */
  companyName: string;
  senderName: string;
  senderRole: string;
  replyToEmail: string;
  websiteUrl: string;
  /** Claims the agents are allowed to make. Anything not here is off limits. */
  approvedClaims: string[];
  /** Services the company actually sells. Recommendations are limited to these. */
  offeredServices: string[];
  /** Price guidance. Agents may never quote outside these bands without approval. */
  pricingPolicy: string;
  /**
   * The public domain the landing page is served on. Settable here as well as
   * through MARKETING_DOMAIN, so pointing a domain at the platform does not
   * require a redeploy — the env var still wins when it is set.
   */
  marketingDomain: string;
  /** Never allow autonomous mass messaging in the MVP. */
  outboundSendingEnabled: boolean;
  requireApprovalForFirstContact: boolean;
  demoMode: boolean;
  defaultCountry: string;
  defaultCity: string;
  dailyOutreachCap: number;
}

const DEFAULTS: PlatformSettings = {
  companyName: 'Your Agency',
  senderName: 'AI CEO Assistant',
  senderRole: 'Automation Consultant',
  replyToEmail: '',
  websiteUrl: '',
  approvedClaims: [
    'We build websites, mobile apps, booking and ordering systems.',
    'We build AI assistants that answer customer questions on WhatsApp and websites.',
    'We automate repetitive internal business processes.',
  ],
  offeredServices: [],
  pricingPolicy:
    'Never quote a specific price. Offer a free scoping call and route any pricing question to a human.',
  marketingDomain: '',
  outboundSendingEnabled: false,
  requireApprovalForFirstContact: true,
  demoMode: true,
  defaultCountry: 'United Arab Emirates',
  defaultCity: 'Dubai',
  dailyOutreachCap: 25,
};

const SETTINGS_KEY = 'platform_settings';

export function getSettings(): PlatformSettings {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as
    | { value: string }
    | undefined;
  const stored = parseJson<Partial<PlatformSettings>>(row?.value, {});
  const merged = { ...DEFAULTS, ...stored };

  // Environment kill-switches always win over stored settings — a stored
  // `true` can never enable sending if the deployment disabled it.
  merged.outboundSendingEnabled = merged.outboundSendingEnabled && env.outboundSendingEnabled;
  merged.marketingDomain = (env.marketingDomain || merged.marketingDomain).trim().toLowerCase();
  return merged;
}

export function updateSettings(patch: Partial<PlatformSettings>): PlatformSettings {
  const next = { ...getSettings(), ...patch };
  // The MVP rule: first contact always needs a human.
  next.requireApprovalForFirstContact = true;
  db()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, @updated_at)
       ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updated_at`,
    )
    .run({ key: SETTINGS_KEY, value: toJson(next), updated_at: nowIso() });
  return getSettings();
}
