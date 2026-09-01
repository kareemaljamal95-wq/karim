/**
 * Real email delivery.
 *
 * This is the piece that turns an approved draft into a message that actually
 * arrives. Everything before it — the approval, the environment kill-switch,
 * the connected-integration check, the daily cap — decides *whether* to call
 * this; this module only performs the delivery and reports honestly whether it
 * succeeded.
 *
 * Two transports, because one is not always available. SMTP is the obvious
 * route, but most hosting platforms block outbound SMTP ports on their lower
 * plans to protect their IP reputation, and a blocked port looks exactly like a
 * hung connection. Resend delivers over HTTPS instead, which no host blocks, so
 * it is preferred whenever it is connected. Credentials for both are stored
 * encrypted like every other connector.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { getCredentials, isActive, recordIntegrationCheck } from '../services/integrations';
import type { PlatformSettings } from '../services/settings';

/** Defaults, used when the connector leaves the server fields blank. */
const DEFAULT_SMTP_HOST = 'smtp.gmail.com';
const DEFAULT_SMTP_PORT = 465;

interface SmtpAccount {
  user: string;
  password: string;
  host: string;
  port: number;
}

/**
 * Reads the SMTP account from the connector.
 *
 * The host and port are optional so the common case — Gmail — needs only an
 * address and an App Password, while a mailbox on the operator's own domain
 * works by filling in that provider's server.
 */
function smtpAccount(): SmtpAccount | null {
  const credentials = getCredentials('gmail');
  const user = credentials.user?.trim();
  const password = credentials.appPassword?.replace(/\s+/g, '');
  if (!user || !password) return null;

  const port = Number(credentials.port?.trim() || DEFAULT_SMTP_PORT);
  return {
    user,
    password,
    host: credentials.host?.trim() || DEFAULT_SMTP_HOST,
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_SMTP_PORT,
  };
}

/** Either transport counts: the channel is connected if one of them can send. */
export const emailDeliveryAvailable = (): boolean => isActive('resend') || isActive('gmail');

/**
 * The address outreach will actually come from, or null when no transport is
 * configured. It follows the same preference order as delivery, so the envelope
 * a draft is built with is the one the message is really sent with.
 */
export function sendingAddress(): string | null {
  const viaResend = resendAccount();
  if (isActive('resend') && viaResend) return viaResend.from;
  return smtpAccount()?.user ?? null;
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
}

export interface DeliveryResult {
  delivered: boolean;
  detail: string;
}

/**
 * Builds the outgoing message from a draft and the platform identity.
 *
 * Kept pure and separate from the transport so the envelope — who it claims to
 * be from, where a reply goes — can be asserted in tests without sending
 * anything. The sending address is always the authenticated account: a
 * different From would be rejected by Gmail and would read as a forgery.
 */
export function buildEmail(
  message: { subject: string | null; body: string },
  recipient: string,
  account: string,
  settings: Pick<PlatformSettings, 'companyName' | 'senderName' | 'replyToEmail'>,
): EmailPayload {
  const fromName = settings.companyName.trim() || settings.senderName.trim() || account;
  const replyTo = settings.replyToEmail.trim();
  return {
    to: recipient,
    subject: message.subject?.trim() || `${fromName}`,
    body: message.body,
    fromName,
    fromAddress: account,
    replyTo: replyTo && replyTo.toLowerCase() !== account.toLowerCase() ? replyTo : null,
  };
}

let transporter: Transporter | null = null;
let transporterAccount: string | null = null;

function transportFor(account: SmtpAccount): Transporter {
  // Reuse the connection pool unless the account changed underneath us.
  const identity = `${account.user}@${account.host}:${account.port}`;
  if (transporter && transporterAccount === identity) return transporter;
  transporter = nodemailer.createTransport({
    host: account.host,
    port: account.port,
    // 465 is implicit TLS; 587 and 25 upgrade with STARTTLS.
    secure: account.port === 465,
    auth: { user: account.user, pass: account.password },
  });
  transporterAccount = identity;
  return transporter;
}

/** Drops the cached transport, so re-entered credentials take effect at once. */
export function resetEmailTransport(): void {
  transporter?.close();
  transporter = null;
  transporterAccount = null;
}

/**
 * Checks the stored credentials against Gmail without sending anything.
 *
 * SMTP authenticates before any message is offered, so this proves the address
 * and App Password are accepted while nobody receives mail. It is the safe way
 * to answer "did I set this up correctly?" — the alternative is emailing a real
 * business to find out.
 */
export async function verifyEmailConnection(): Promise<DeliveryResult> {
  // Resend first, matching what delivery actually uses.
  const viaResend = resendAccount();
  if (isActive('resend') && viaResend) return verifyResend(viaResend);

  const account = smtpAccount();
  if (!account) {
    return {
      delivered: false,
      detail: 'No email transport is configured. Add an API key under Resend, or an address and password under Email (SMTP).',
    };
  }
  // Gmail is the one provider with a fixed password shape, so a wrong one can
  // be named before the network call rather than after an opaque rejection.
  if (account.host === DEFAULT_SMTP_HOST && account.password.length !== 16) {
    return {
      delivered: false,
      detail: `A Google App Password is exactly 16 characters; this one is ${account.password.length}. An ordinary account password will not work.`,
    };
  }

  try {
    await transportFor(account).verify();
    recordIntegrationCheck('gmail', null);
    return {
      delivered: true,
      detail: `${account.host} accepted the credentials for ${account.user}. No email was sent.`,
    };
  } catch (error) {
    const detail = explainSmtpError(error);
    recordIntegrationCheck('gmail', detail);
    resetEmailTransport();
    return { delivered: false, detail };
  }
}

/** Google's SMTP rejections are opaque; name the actual fix instead. */
function explainSmtpError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/invalid login|username and password not accepted|535/i.test(raw)) {
    return 'Gmail rejected the credentials. The sending address must match the account the App Password was created in, 2-step verification must be on, and the password must be the 16-character App Password rather than the account password.';
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(raw)) {
    return `Could not reach the mail server: ${raw}`;
  }
  return raw;
}

/**
 * Delivers one email. Never throws: the caller decides what a failure means for
 * the message's status, and a delivery that did not happen must never be
 * recorded as one that did.
 */
export async function deliverEmail(payload: EmailPayload): Promise<DeliveryResult> {
  // HTTPS is preferred: it works on hosts that block SMTP, and a blocked port
  // is indistinguishable from a hung connection until it times out.
  const viaResend = resendAccount();
  if (isActive('resend') && viaResend) return deliverViaResend(payload, viaResend);

  const account = smtpAccount();
  if (!account) {
    return { delivered: false, detail: 'The email connector has no sending address or password.' };
  }

  try {
    const info = await transportFor(account).sendMail({
      from: { name: payload.fromName, address: account.user },
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    });
    recordIntegrationCheck('gmail', null);
    return { delivered: true, detail: `Accepted by ${account.host} (id ${info.messageId}).` };
  } catch (error) {
    const detail = explainSmtpError(error);
    recordIntegrationCheck('gmail', detail);
    resetEmailTransport();
    return { delivered: false, detail };
  }
}

// --- Resend (HTTPS) ---------------------------------------------------------

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 15_000;

interface ResendAccount {
  apiKey: string;
  from: string;
}

function resendAccount(): ResendAccount | null {
  const credentials = getCredentials('resend');
  const apiKey = credentials.apiKey?.trim();
  const from = credentials.from?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

async function resendRequest(
  url: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
    });
    return { ok: response.ok, status: response.status, body: await response.text().catch(() => '') };
  } finally {
    clearTimeout(timer);
  }
}

/** Turns Resend's JSON error into the sentence that names the fix. */
function explainResendError(status: number, body: string): string {
  let message = body;
  try {
    message = (JSON.parse(body) as { message?: string }).message ?? body;
  } catch {
    /* not JSON — use the raw body */
  }
  if (status === 401 || status === 403) {
    return `Resend rejected the API key: ${message}`;
  }
  if (status === 403 || /domain is not verified/i.test(message)) {
    return `Resend will not send from that address yet: ${message}`;
  }
  if (status === 422) {
    return `Resend rejected the message: ${message}`;
  }
  return `Resend returned HTTP ${status}: ${message}`;
}

async function deliverViaResend(payload: EmailPayload, account: ResendAccount): Promise<DeliveryResult> {
  try {
    const result = await resendRequest(RESEND_ENDPOINT, account.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        from: `${payload.fromName} <${account.from}>`,
        to: [payload.to],
        subject: payload.subject,
        text: payload.body,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
      }),
    });

    if (!result.ok) {
      const detail = explainResendError(result.status, result.body);
      recordIntegrationCheck('resend', detail);
      return { delivered: false, detail };
    }

    recordIntegrationCheck('resend', null);
    const id = (() => {
      try {
        return (JSON.parse(result.body) as { id?: string }).id ?? 'accepted';
      } catch {
        return 'accepted';
      }
    })();
    return { delivered: true, detail: `Accepted by Resend (id ${id}).` };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === 'AbortError'
        ? 'Resend did not respond in time.'
        : `Could not reach Resend: ${error instanceof Error ? error.message : String(error)}`;
    recordIntegrationCheck('resend', detail);
    return { delivered: false, detail };
  }
}

/** Checks the Resend key without sending, by listing the account's domains. */
async function verifyResend(account: ResendAccount): Promise<DeliveryResult> {
  try {
    const result = await resendRequest('https://api.resend.com/domains', account.apiKey);
    if (!result.ok) {
      const detail = explainResendError(result.status, result.body);
      recordIntegrationCheck('resend', detail);
      return { delivered: false, detail };
    }
    recordIntegrationCheck('resend', null);
    return {
      delivered: true,
      detail: `Resend accepted the API key. Outreach will be sent from ${account.from}. No email was sent.`,
    };
  } catch (error) {
    const detail = `Could not reach Resend: ${error instanceof Error ? error.message : String(error)}`;
    recordIntegrationCheck('resend', detail);
    return { delivered: false, detail };
  }
}
