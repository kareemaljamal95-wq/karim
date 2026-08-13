import { db } from '../db';
import {
  getApproval,
  recordDecision,
  type Approval,
} from './approvals';
import { listMessages, markApproved, markRejected, sendMessage } from './messages';
import { getLead, setLeadStatus, updateLead } from './leads';
import { updateProject } from './projects';
import { getSettings } from './settings';
import { updateRun } from './runs';
import { log } from './logger';

export interface DecisionResult {
  approval: Approval;
  /** What actually happened as a result of the decision. */
  effects: string[];
  dispatched: boolean;
}

/**
 * Applies the consequences of a human approval decision.
 *
 * This is the only place in the platform where an approval turns into action,
 * which keeps the "nothing irreversible without a human" rule enforceable in
 * one reviewable spot.
 */
export function decideApproval(
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  actor: string,
  note?: string,
): DecisionResult {
  const approval = recordDecision(id, decision, actor, note);
  const effects: string[] = [];
  let dispatched = false;

  if (decision === 'REJECTED') {
    applyRejection(approval, actor, note, effects);
  } else {
    dispatched = applyApproval(approval, actor, effects);
  }

  if (approval.runId) maybeCompleteRun(approval.runId);

  return { approval, effects, dispatched };
}

function applyApproval(approval: Approval, actor: string, effects: string[]): boolean {
  const settings = getSettings();
  let dispatched = false;

  switch (approval.entityType) {
    case 'lead': {
      // Approving first contact approves the drafted messages for that lead.
      const drafts = listMessages({ leadId: approval.entityId, status: 'APPROVAL_REQUIRED' });
      for (const draft of drafts) {
        markApproved(draft.id, actor);
        effects.push(`Approved the ${draft.channel} message.`);
      }
      const lead = getLead(approval.entityId);
      setLeadStatus(lead.id, 'QUALIFIED', actor, 'First contact approved by a human.');

      if (settings.outboundSendingEnabled) {
        for (const draft of listMessages({ leadId: approval.entityId, status: 'APPROVED' })) {
          try {
            const result = sendMessage(draft.id, actor);
            if (result.dispatched) {
              dispatched = true;
              effects.push(`Dispatched the ${draft.channel} message.`);
            } else {
              effects.push(result.reason);
            }
          } catch (error) {
            effects.push(
              `The ${draft.channel} message stays queued: ${
                error instanceof Error ? error.message : 'delivery unavailable'
              }`,
            );
          }
        }
      } else {
        effects.push(
          'Outbound sending is disabled, so the approved messages are queued rather than sent.',
        );
      }
      break;
    }

    case 'message': {
      markApproved(approval.entityId, actor);
      effects.push('Message approved.');
      if (settings.outboundSendingEnabled) {
        try {
          const result = sendMessage(approval.entityId, actor);
          dispatched = result.dispatched;
          effects.push(result.reason);
        } catch (error) {
          effects.push(
            `Message stays queued: ${error instanceof Error ? error.message : 'delivery unavailable'}`,
          );
        }
      } else {
        effects.push('Outbound sending is disabled, so the message is queued rather than sent.');
      }
      break;
    }

    case 'project': {
      updateProject(approval.entityId, { status: 'SCOPING' }, actor);
      effects.push('Project request accepted for scoping.');
      break;
    }

    default:
      effects.push('Decision recorded. No automatic action is attached to this approval type.');
  }

  log({
    actorType: 'user',
    actor,
    action: 'approval.effects_applied',
    entityType: 'approval',
    entityId: approval.id,
    runId: approval.runId,
    message: effects.join(' '),
  });

  return dispatched;
}

function applyRejection(approval: Approval, actor: string, note: string | undefined, effects: string[]): void {
  switch (approval.entityType) {
    case 'lead': {
      for (const draft of listMessages({ leadId: approval.entityId, status: 'APPROVAL_REQUIRED' })) {
        markRejected(draft.id, actor, note);
        effects.push(`Rejected the ${draft.channel} draft.`);
      }
      updateLead(
        approval.entityId,
        { status: 'NOT_A_FIT', nextAction: note ?? 'Outreach rejected by a human.' },
        actor,
      );
      effects.push('Lead marked NOT_A_FIT.');
      break;
    }
    case 'message': {
      markRejected(approval.entityId, actor, note);
      effects.push('Message rejected and removed from the send queue.');
      break;
    }
    case 'project': {
      updateProject(approval.entityId, { status: 'DECLINED', notes: note ?? '' }, actor);
      effects.push('Project request declined.');
      break;
    }
    default:
      effects.push('Rejection recorded.');
  }
}

/** Closes a run once every approval it opened has been decided. */
function maybeCompleteRun(runId: string): void {
  const pending = db()
    .prepare(`SELECT COUNT(*) AS c FROM approvals WHERE run_id = ? AND status = 'PENDING'`)
    .get(runId) as { c: number };
  if (pending.c > 0) return;

  db()
    .prepare(`UPDATE run_steps SET status = 'COMPLETED' WHERE run_id = ? AND status = 'WAITING_APPROVAL'`)
    .run(runId);
  updateRun(runId, { status: 'COMPLETED' });

  log({
    actorType: 'system',
    actor: 'orchestrator',
    action: 'run.completed',
    entityType: 'run',
    entityId: runId,
    runId,
    message: 'All approval gates for this run have been decided; the run is complete.',
  });
}
