/**
 * Re-drafts one saved message from the lead's current analysis.
 *
 * A draft is a snapshot: it is written once, when discovery runs, and then sits
 * in the approval queue. Anything that happens afterwards — the lead's website
 * gets verified, the recommended service changes, a model is connected where
 * the rule engine answered before, the wording itself is improved — leaves the
 * stored copy describing a business the platform no longer sees that way.
 *
 * Re-running the workflow is not the answer: it would re-discover every lead to
 * rewrite one message. This runs the outreach agent alone, for a single message,
 * against what the lead looks like now.
 *
 * The result goes back through `editMessage`, so a re-drafted message returns to
 * APPROVAL_REQUIRED. New words are a new message as far as the gate is
 * concerned, and nobody has read these yet.
 */
import { runOutreachAgent, type OutreachSubject } from '../agents/outreachAgent';
import { serviceByKey } from '../domain/services';
import { editMessage, getMessage, type Message } from '../services/messages';
import { getLead, type Lead } from '../services/leads';
import { conflict, failedDependency } from '../util/errors';
import { log } from '../services/logger';

export interface Redraft {
  message: Message;
  previousBody: string;
  changed: boolean;
}

/** Describes a stored lead the way the outreach agent expects to be briefed. */
function subjectOf(lead: Lead): OutreachSubject {
  const service = lead.recommendedService ? serviceByKey(lead.recommendedService) : null;
  return {
    businessName: lead.businessName,
    category: lead.category,
    city: lead.city,
    recommendedServiceLabel: lead.recommendedServiceLabel ?? service?.label ?? null,
    problem: lead.problem ?? '',
    // The same three the drafting step uses. More than that and the message
    // stops being a note and starts being a report.
    evidence: lead.signals.slice(0, 3).map((signal) => signal.evidence),
    benefit: service?.summary ?? '',
    serviceSummary: service?.summary ?? null,
    hasEmail: Boolean(lead.email),
    hasPhone: Boolean(lead.phone),
  };
}

export async function redraftMessage(messageId: string, actor: string): Promise<Redraft> {
  const message = getMessage(messageId);
  if (message.status === 'SENT') {
    throw conflict('This message has already been sent. Draft a new one instead of rewriting it.');
  }

  const lead = getLead(message.leadId);
  const result = await runOutreachAgent(subjectOf(lead), [message.channel], { actor });
  const draft = result.data.messages.find((m) => m.channel === message.channel);
  if (!draft) {
    throw failedDependency(`The outreach agent produced nothing for the ${message.channel} channel.`);
  }

  const changed = draft.body !== message.body || draft.subject !== message.subject;
  if (!changed) {
    // Nothing to show for it, and rewriting the row would reset an approval for
    // text that did not move a character.
    return { message, previousBody: message.body, changed: false };
  }

  const updated = editMessage(
    messageId,
    { subject: draft.subject, body: draft.body, quality: draft.quality },
    actor,
  );

  log({
    actorType: 'user',
    actor,
    action: 'message.redrafted',
    entityType: 'message',
    entityId: messageId,
    message: `Message to ${lead.businessName} re-drafted from the current analysis; it returns to the approval queue`,
    meta: { channel: message.channel, qualityScore: draft.quality.score },
  });

  return { message: updated, previousBody: message.body, changed: true };
}
