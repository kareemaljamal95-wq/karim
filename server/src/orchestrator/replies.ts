import { runConversationAgent, type ConversationAnalysis } from '../agents/conversationAgent';
import { runRequirementsAgent } from '../agents/requirementsAgent';
import { getLead, updateLead } from '../services/leads';
import { lastOutboundBody, recordInboundReply, type ConversationEntry } from '../services/conversations';
import { createMessage } from '../services/messages';
import { createApproval } from '../services/approvals';
import { createProject, type Project } from '../services/projects';
import { log } from '../services/logger';
import type { MessageChannel, LeadStatus } from '../types';

export interface ReplyHandlingResult {
  conversation: ConversationEntry;
  analysis: ConversationAnalysis;
  leadStatus: LeadStatus;
  draftedReplyId: string | null;
  project: Project | null;
  approvalsCreated: string[];
  requiresHuman: boolean;
}

/** Maps a detected intent to the lead status it implies. */
function statusForIntent(analysis: ConversationAnalysis): LeadStatus {
  switch (analysis.intent) {
    case 'not_interested':
    case 'unsubscribe':
      return 'NOT_A_FIT';
    case 'interested':
    case 'requesting_meeting':
      return 'INTERESTED';
    case 'requesting_price':
      return 'NEGOTIATING';
    default:
      return 'REPLIED';
  }
}

/**
 * Inbound reply pipeline.
 *
 * Reads the reply, updates the lead, converts a concrete request into a
 * structured project, and queues any suggested response for approval. Nothing
 * here sends anything — a reply only ever produces drafts and approval gates.
 */
export async function handleInboundReply(input: {
  leadId: string;
  channel: MessageChannel;
  body: string;
  actor: string;
}): Promise<ReplyHandlingResult> {
  const lead = getLead(input.leadId);
  const approvalsCreated: string[] = [];

  const outcome = await runConversationAgent(
    {
      businessName: lead.businessName,
      recommendedServiceLabel: lead.recommendedServiceLabel,
      lastOutboundMessage: lastOutboundBody(lead.id),
      replyBody: input.body,
    },
    { actor: input.actor },
  );
  const analysis = outcome.data;

  const conversation = recordInboundReply({
    leadId: lead.id,
    channel: input.channel,
    body: input.body,
    analysis,
  });

  const nextStatus = statusForIntent(analysis);
  updateLead(
    lead.id,
    {
      status: nextStatus,
      nextAction: analysis.requiresHuman
        ? (analysis.humanReason ?? 'A human needs to review this reply.')
        : 'Review the drafted response and approve it.',
    },
    input.actor,
  );

  log({
    actorType: 'agent',
    actor: 'conversation_agent',
    action: 'reply.analysed',
    entityType: 'lead',
    entityId: lead.id,
    message: `Reply from ${lead.businessName} classified as "${analysis.intent}" (${analysis.sentiment})`,
    meta: {
      buyingSignals: analysis.buyingSignals,
      objections: analysis.objections,
      requiresHuman: analysis.requiresHuman,
      validation: outcome.validation.passed,
    },
  });

  // A concrete request becomes a structured project request for human review.
  let project: Project | null = null;
  const wantsWork =
    analysis.extractedRequirements.length > 0 ||
    ['interested', 'requesting_meeting', 'requesting_price'].includes(analysis.intent);

  if (wantsWork && analysis.intent !== 'unsubscribe' && analysis.intent !== 'not_interested') {
    const requirements = await runRequirementsAgent(
      {
        businessName: lead.businessName,
        category: lead.category,
        recommendedServiceLabel: lead.recommendedServiceLabel,
        conversationText: input.body,
      },
      { actor: input.actor },
    );

    if (requirements.validation.passed) {
      project = createProject({
        leadId: lead.id,
        request: requirements.data,
        estimatedValue: lead.estimatedValue,
        sourceConversationId: conversation.id,
      });

      const approval = createApproval({
        kind: 'PROJECT_ACCEPTANCE',
        title: `Project request from ${lead.businessName}`,
        summary: `${requirements.data.service}. ${requirements.data.missingInformation.length} open question(s) before it can be quoted.`,
        entityType: 'project',
        entityId: project.id,
        leadId: lead.id,
        payload: {
          requirements: requirements.data.requirements,
          missingInformation: requirements.data.missingInformation,
        },
        requestedBy: 'requirements_agent',
      });
      approvalsCreated.push(approval.id);
    }
  }

  // A suggested response is a draft that still needs approval.
  let draftedReplyId: string | null = null;
  if (analysis.suggestedReply && analysis.replySafe) {
    const message = createMessage({
      leadId: lead.id,
      channel: input.channel,
      subject: input.channel === 'email' ? `Re: ${lead.businessName}` : null,
      body: analysis.suggestedReply,
      generatedBy: 'conversation_agent',
      variant: 'reply',
      quality: {},
    });
    draftedReplyId = message.id;

    const approval = createApproval({
      kind: analysis.requiresHuman ? 'COMMERCIAL_COMMITMENT' : 'FIRST_OUTREACH',
      title: `Reply to ${lead.businessName}`,
      summary: analysis.requiresHuman
        ? `Escalated: ${analysis.humanReason ?? 'needs a human decision'}`
        : 'Suggested response to an inbound reply.',
      entityType: 'message',
      entityId: message.id,
      leadId: lead.id,
      payload: { intent: analysis.intent, requiresHuman: analysis.requiresHuman },
      requestedBy: 'conversation_agent',
    });
    approvalsCreated.push(approval.id);
  }

  return {
    conversation,
    analysis,
    leadStatus: nextStatus,
    draftedReplyId,
    project,
    approvalsCreated,
    requiresHuman: analysis.requiresHuman,
  };
}
