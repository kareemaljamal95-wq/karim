/**
 * Real email delivery over SMTP.
 *
 * This is the piece that turns an approved draft into a message that actually
 * arrives. Everything before it — the approval, the environment kill-switch,
 * the connected-integration check — decides *whether* to call this; this module
 * only performs the delivery and reports honestly whether it succeeded.
 *
 * Credentials come from the `gmail` connector: the sending address and a Google
 * App Password, stored encrypted like every other credential. A plain account
 * password will not work — Google requires an App Password for SMTP, which is
 * revocable on its own without touching the account.
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

export const emailDeliveryAvailable = (): boolean => isActive('gmail');

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
  const account = smtpAccount();
  if (!account) {
    return { delivered: false, detail: 'No sending address or password is saved yet.' };
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
