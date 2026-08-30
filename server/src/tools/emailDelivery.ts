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

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;

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

function transportFor(account: string, appPassword: string): Transporter {
  // Reuse the connection pool unless the credentials changed underneath us.
  if (transporter && transporterAccount === account) return transporter;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: { user: account, pass: appPassword },
  });
  transporterAccount = account;
  return transporter;
}

/** Drops the cached transport, so re-entered credentials take effect at once. */
export function resetEmailTransport(): void {
  transporter?.close();
  transporter = null;
  transporterAccount = null;
}

/**
 * Delivers one email. Never throws: the caller decides what a failure means for
 * the message's status, and a delivery that did not happen must never be
 * recorded as one that did.
 */
export async function deliverEmail(payload: EmailPayload): Promise<DeliveryResult> {
  const credentials = getCredentials('gmail');
  const account = credentials.user?.trim();
  const appPassword = credentials.appPassword?.replace(/\s+/g, '');

  if (!account || !appPassword) {
    return { delivered: false, detail: 'The email connector has no sending address or App Password.' };
  }

  try {
    const info = await transportFor(account, appPassword).sendMail({
      from: { name: payload.fromName, address: account },
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    });
    recordIntegrationCheck('gmail', null);
    return { delivered: true, detail: `Accepted by ${SMTP_HOST} (id ${info.messageId}).` };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Google's SMTP rejection for a wrong or missing App Password is verbose
    // and unhelpful; name the actual fix instead.
    const detail = /invalid login|username and password not accepted|535/i.test(raw)
      ? 'Gmail rejected the credentials. The sending address must match the account, and the password must be a 16-character App Password with 2-step verification enabled.'
      : raw;
    recordIntegrationCheck('gmail', detail);
    resetEmailTransport();
    return { delivered: false, detail };
  }
}
