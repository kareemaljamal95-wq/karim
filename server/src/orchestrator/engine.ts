import { runMarketScout } from '../agents/marketScout';
import { runOpportunityAnalyst, type OpportunityResult } from '../agents/opportunityAnalyst';
import { runServiceStrategist, type StrategyResult } from '../agents/serviceStrategist';
import { runLeadScorer, type LeadScoringResult } from '../agents/leadScorer';
import { runOutreachAgent, type DraftedMessage } from '../agents/outreachAgent';
import { getAgent } from '../agents/registry';
import { inspectWebsite, websiteInspectionAvailable } from '../tools/webEnrichment';
import type { AgentOutcome } from '../agents/types';
import { failedChecks, type ValidationReport } from '../agents/verification';
import type { DiscoveredBusiness } from '../domain/business';
import { serviceByKey } from '../domain/services';
import { log } from '../services/logger';
import { upsertLead, type Lead } from '../services/leads';
import { createMessage } from '../services/messages';
import { createApproval } from '../services/approvals';
import { getSettings } from '../services/settings';
import {
  createRun,
  finishStep,
  recordResearchRun,
  startStep,
  updateRun,
  type PlanStep,
} from '../services/runs';
import { getDefaultWorkflow, getWorkflow } from '../services/workflows';
import { executionOrder, type ConditionConfig, type WorkflowNode } from './workflowTypes';
import type { MessageChannel } from '../types';

export interface DiscoveryRunInput {
  country: string;
  city: string;
  area?: string;
  category: string;
  limit?: number;
  workflowId?: string | null;
  /** Skip drafting outreach — research only. */
  draftOutreach?: boolean;
  actor: string;
}

export interface AnalysedBusiness {
  business: DiscoveredBusiness;
  opportunity: OpportunityResult;
  strategy: StrategyResult | null;
  scoring: LeadScoringResult | null;
  lead: Lead | null;
  qualified: boolean;
  disqualifiedReason: string | null;
}

export interface DiscoveryRunSummary {
  runId: string;
  researchRunId: string;
  status: 'COMPLETED' | 'WAITING_APPROVAL' | 'FAILED';
  demo: boolean;
  source: string;
  query: string;
  notice: string | null;
  discovered: number;
  imported: number;
  duplicates: number;
  qualified: number;
  messagesDrafted: number;
  approvalsCreated: number;
  leads: Lead[];
  warnings: string[];
}

/**
 * The AI CEO orchestrator.
 *
 * Turns a research goal into an execution plan derived from the workflow graph,
 * delegates each node to the right specialist agent, validates every result
 * against that agent's own self-verification report, retries recoverable
 * failures within the agent's configured retry limit, and stops at the approval
 * gate before anything becomes externally visible.
 */
export async function runDiscoveryWorkflow(input: DiscoveryRunInput): Promise<DiscoveryRunSummary> {
  const workflow = input.workflowId ? getWorkflow(input.workflowId) : getDefaultWorkflow();
  const nodes = executionOrder(workflow.definition);
  const plan: PlanStep[] = nodes.map((node) => ({
    nodeId: node.id,
    label: node.label,
    kind: node.type,
    agentKey: node.agent ?? null,
  }));

  const goal = `Find ${input.category} in ${[input.area, input.city, input.country].filter(Boolean).join(', ')} that need digital or AI services`;

  const runId = createRun({
    workflowId: workflow.id,
    goal,
    input: { ...input, actor: undefined },
    plan,
    startedBy: input.actor,
  });

  log({
    actorType: 'agent',
    actor: 'orchestrator',
    action: 'run.started',
    entityType: 'run',
    entityId: runId,
    runId,
    message: `Plan created with ${plan.length} steps for goal: ${goal}`,
    meta: { workflow: workflow.name, plan: plan.map((p) => p.label) },
  });

  const warnings: string[] = [];
  let seq = 0;
  let analysed: AnalysedBusiness[] = [];
  let source = 'demo';
  let demo = true;
  let query = goal;
  let notice: string | null = null;
  let imported = 0;
  let duplicates = 0;
  let messagesDrafted = 0;
  let approvalsCreated = 0;

  try {
    for (const node of nodes) {
      seq += 1;

      // ---- Trigger -------------------------------------------------------
      if (node.type === 'trigger') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: null,
          stepInput: { country: input.country, city: input.city, area: input.area, category: input.category },
        });
        finishStep(stepId, { status: 'COMPLETED', output: { accepted: true }, attempts: 1 });
        continue;
      }

      // ---- Market Scout --------------------------------------------------
      if (node.type === 'agent' && node.agent === 'market_scout') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: node.agent,
          stepInput: { ...input, actor: undefined },
        });

        const result = await withRetry('market_scout', () =>
          runMarketScout(
            {
              country: input.country,
              city: input.city,
              area: input.area,
              category: input.category,
              limit: input.limit ?? (node.config?.limit as number) ?? 12,
            },
            { runId },
          ),
        );

        if (!result.outcome) {
          finishStep(stepId, {
            status: 'FAILED',
            error: result.error,
            attempts: result.attempts,
            validation: result.validation,
          });
          updateRun(runId, { status: 'FAILED', error: result.error });
          throw new Error(result.error ?? 'Discovery failed');
        }

        const scout = result.outcome.data;
        source = scout.source;
        demo = scout.demo;
        query = scout.query;
        notice = scout.notice;
        analysed = scout.businesses.map((business) => ({
          business,
          opportunity: null as unknown as OpportunityResult,
          strategy: null,
          scoring: null,
          lead: null,
          qualified: false,
          disqualifiedReason: null,
        }));
        warnings.push(...result.outcome.validation.warnings);

        finishStep(stepId, {
          status: 'COMPLETED',
          output: { stats: scout.stats, source: scout.source, query: scout.query },
          validation: result.outcome.validation,
          attempts: result.attempts,
        });
        updateRun(runId, { demo });
        continue;
      }

      // ---- Website verification ------------------------------------------
      if (node.type === 'tool' && node.tool === 'website_inspection') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: null,
          stepInput: { candidates: analysed.filter((item) => item.business.website).length },
        });

        if (!websiteInspectionAvailable()) {
          finishStep(stepId, {
            status: 'COMPLETED',
            output: {
              skipped: true,
              reason: 'Website verification is not enabled in Integrations, so no site was visited.',
            },
            attempts: 1,
          });
          continue;
        }

        const verification = await verifyWebsites(analysed, runId);
        finishStep(stepId, {
          status: 'COMPLETED',
          output: verification,
          attempts: 1,
        });
        continue;
      }

      // ---- Opportunity Analyst -------------------------------------------
      if (node.type === 'agent' && node.agent === 'opportunity_analyst') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: node.agent,
          stepInput: { businesses: analysed.length },
        });

        const perItem: ValidationReport[] = [];
        const failures: string[] = [];
        for (const item of analysed) {
          const result = await withRetry('opportunity_analyst', () =>
            runOpportunityAnalyst(item.business, { runId }),
          );
          if (result.outcome) {
            item.opportunity = result.outcome.data;
            perItem.push(result.outcome.validation);
          } else {
            // One business failing must not abort research on the rest.
            failures.push(`${item.business.name}: ${result.error}`);
            item.disqualifiedReason = `Analysis failed: ${result.error}`;
          }
        }
        analysed = analysed.filter((item) => item.opportunity !== null && item.opportunity !== undefined);

        finishStep(stepId, {
          status: failures.length === perItem.length + failures.length ? 'FAILED' : 'COMPLETED',
          output: { analysed: analysed.length, failed: failures.length },
          validation: mergeReports(perItem, failures),
          attempts: 1,
        });
        if (failures.length) warnings.push(...failures);
        continue;
      }

      // ---- Service Strategist --------------------------------------------
      if (node.type === 'agent' && node.agent === 'service_strategist') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: node.agent,
          stepInput: { businesses: analysed.length },
        });

        const reports: ValidationReport[] = [];
        for (const item of analysed) {
          const result = await withRetry('service_strategist', () =>
            runServiceStrategist(item.business, item.opportunity.candidateServices, { runId }),
          );
          if (result.outcome) {
            item.strategy = result.outcome.data;
            reports.push(result.outcome.validation);
          }
        }

        finishStep(stepId, {
          status: 'COMPLETED',
          output: {
            recommended: analysed.filter((i) => i.strategy?.recommendedService).length,
            noFit: analysed.filter((i) => !i.strategy?.recommendedService).length,
          },
          validation: mergeReports(reports, []),
          attempts: 1,
        });
        continue;
      }

      // ---- Lead Scorer ----------------------------------------------------
      if (node.type === 'agent' && node.agent === 'lead_scorer') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: node.agent,
          stepInput: { businesses: analysed.length },
        });

        const reports: ValidationReport[] = [];
        for (const item of analysed) {
          const topMatch = item.opportunity.candidateServices[0] ?? null;
          const result = await withRetry('lead_scorer', () =>
            runLeadScorer(
              item.business,
              item.opportunity.signals,
              {
                score: item.opportunity.score,
                confidence: item.opportunity.confidence,
                drivers: item.opportunity.drivers,
              },
              topMatch,
              item.strategy?.estimatedValue ?? item.opportunity.estimatedValue,
              { runId },
            ),
          );
          if (result.outcome) {
            item.scoring = result.outcome.data;
            reports.push(result.outcome.validation);
          }
        }

        finishStep(stepId, {
          status: 'COMPLETED',
          output: {
            gradeA: analysed.filter((i) => i.scoring?.grade === 'A').length,
            gradeB: analysed.filter((i) => i.scoring?.grade === 'B').length,
            gradeC: analysed.filter((i) => i.scoring?.grade === 'C').length,
          },
          validation: mergeReports(reports, []),
          attempts: 1,
        });
        continue;
      }

      // ---- Save leads -----------------------------------------------------
      if (node.type === 'action' && node.config?.action === 'save_leads') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: null,
          stepInput: { candidates: analysed.length },
        });

        for (const item of analysed) {
          const { lead, created } = upsertLead({
            business: item.business,
            analysis: item.scoring
              ? {
                  opportunityScore: item.opportunity.score,
                  confidence: item.opportunity.confidence,
                  signals: item.opportunity.signals,
                  problem: item.opportunity.problem,
                  reason: item.strategy?.reason ?? item.opportunity.summary,
                  recommendedService: item.strategy?.recommendedService ?? null,
                  estimatedValue: item.strategy?.estimatedValue ?? item.opportunity.estimatedValue,
                  leadScore: item.scoring.score,
                  leadGrade: item.scoring.grade,
                  scoreBreakdown: { ...item.scoring.breakdown, caveats: item.scoring.caveats },
                  nextAction: item.scoring.nextAction,
                }
              : undefined,
          });
          item.lead = lead;
          if (created) imported += 1;
          else duplicates += 1;
        }

        finishStep(stepId, {
          status: 'COMPLETED',
          output: { imported, duplicates },
          attempts: 1,
        });
        continue;
      }

      // ---- Qualification condition ----------------------------------------
      if (node.type === 'condition') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: null,
          stepInput: (node.config ?? {}) as Record<string, unknown>,
        });

        const config = (node.config ?? {}) as unknown as ConditionConfig;
        for (const item of analysed) {
          const passes = evaluateCondition(config, item);
          const contactable = Boolean(item.business.email || item.business.phone);
          item.qualified = passes && contactable && Boolean(item.strategy?.recommendedService);
          if (!item.qualified) {
            item.disqualifiedReason = !passes
              ? `${config.field} ${config.operator} ${String(config.value)} was not met`
              : !contactable
                ? 'No usable contact channel'
                : 'No evidence-backed service to offer';
          }
        }

        const qualifiedCount = analysed.filter((i) => i.qualified).length;
        finishStep(stepId, {
          status: 'COMPLETED',
          output: { qualified: qualifiedCount, rejected: analysed.length - qualifiedCount },
          attempts: 1,
        });
        continue;
      }

      // ---- Outreach drafting ----------------------------------------------
      if (node.type === 'agent' && node.agent === 'outreach_agent') {
        if (input.draftOutreach === false) {
          const stepId = startStep({
            runId,
            seq,
            nodeId: node.id,
            label: node.label,
            kind: node.type,
            agentKey: node.agent,
            stepInput: { skipped: true },
          });
          finishStep(stepId, {
            status: 'SKIPPED',
            output: { reason: 'Outreach drafting was switched off for this run.' },
            attempts: 0,
          });
          continue;
        }

        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: node.agent,
          stepInput: { qualified: analysed.filter((i) => i.qualified).length },
        });

        const channels = ((node.config?.channels as MessageChannel[]) ?? ['email', 'whatsapp']).filter(
          Boolean,
        );
        const reports: ValidationReport[] = [];
        const drafts = new Map<string, DraftedMessage[]>();

        for (const item of analysed.filter((i) => i.qualified && i.lead)) {
          const result = await withRetry('outreach_agent', () =>
            runOutreachAgent(
              {
                businessName: item.business.name,
                category: item.business.category,
                city: item.business.city,
                recommendedServiceLabel:
                  item.strategy?.serviceLabel ??
                  (item.strategy?.recommendedService
                    ? (serviceByKey(item.strategy.recommendedService)?.label ?? null)
                    : null),
                problem: item.opportunity.problem,
                evidence: item.opportunity.signals.slice(0, 3).map((s) => s.evidence),
                benefit: item.opportunity.possibleSolution,
                serviceSummary:
                  item.opportunity.candidateServices[0]?.service.summary ??
                  (item.strategy?.recommendedService
                    ? (serviceByKey(item.strategy.recommendedService)?.summary ?? null)
                    : null),
                hasEmail: Boolean(item.business.email),
                hasPhone: Boolean(item.business.phone),
              },
              channels,
              { runId },
            ),
          );

          if (result.outcome) {
            drafts.set(item.lead!.id, result.outcome.data.messages);
            reports.push(result.outcome.validation);
            messagesDrafted += result.outcome.data.messages.length;
          } else {
            warnings.push(`Outreach drafting failed for ${item.business.name}: ${result.error}`);
          }
        }

        // Persist drafts so the approval step has something concrete to gate.
        for (const [leadId, messages] of drafts) {
          for (const message of messages) {
            createMessage({
              leadId,
              channel: message.channel,
              subject: message.subject,
              body: message.body,
              quality: message.quality,
              variant: message.channel,
            });
          }
        }

        finishStep(stepId, {
          status: 'COMPLETED',
          output: { leadsDrafted: drafts.size, messages: messagesDrafted },
          validation: mergeReports(reports, []),
          attempts: 1,
        });
        continue;
      }

      // ---- Human approval gate --------------------------------------------
      if (node.type === 'approval') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: null,
          stepInput: { kind: node.config?.kind ?? 'FIRST_OUTREACH' },
        });

        for (const item of analysed.filter((i) => i.qualified && i.lead)) {
          const lead = item.lead!;
          createApproval({
            kind: 'FIRST_OUTREACH',
            title: `First contact with ${lead.businessName}`,
            summary: `${item.strategy?.serviceLabel ?? 'Service'} — grade ${item.scoring?.grade ?? '?'} lead in ${lead.city}. Review the drafted messages before anything is sent.`,
            entityType: 'lead',
            entityId: lead.id,
            leadId: lead.id,
            runId,
            stepId,
            payload: {
              opportunityScore: item.opportunity.score,
              leadScore: item.scoring?.score ?? null,
              recommendedService: item.strategy?.recommendedService ?? null,
              evidence: item.opportunity.signals.slice(0, 3).map((s) => s.evidence),
            },
          });
          approvalsCreated += 1;
        }

        finishStep(stepId, {
          status: approvalsCreated > 0 ? 'WAITING_APPROVAL' : 'COMPLETED',
          output: { approvalsCreated },
          attempts: 1,
        });
        continue;
      }

      // ---- Post-approval send ---------------------------------------------
      if (node.type === 'action' && node.config?.action === 'send_after_approval') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: null,
          stepInput: {},
        });
        const settings = getSettings();
        finishStep(stepId, {
          status: approvalsCreated > 0 ? 'WAITING_APPROVAL' : 'SKIPPED',
          output: {
            blockedBy: approvalsCreated > 0 ? 'Pending human approval' : 'Nothing to send',
            outboundSendingEnabled: settings.outboundSendingEnabled,
            note: settings.outboundSendingEnabled
              ? 'Approved messages will be dispatched over a connected channel.'
              : 'Outbound sending is disabled, so approved messages stay queued.',
          },
          attempts: 0,
        });
        continue;
      }

      // ---- Notify -----------------------------------------------------------
      if (node.type === 'action' && node.config?.action === 'notify') {
        const stepId = startStep({
          runId,
          seq,
          nodeId: node.id,
          label: node.label,
          kind: node.type,
          agentKey: null,
          stepInput: {},
        });
        const summaryLine = `${imported} new leads, ${duplicates} duplicates skipped, ${analysed.filter((i) => i.qualified).length} qualified, ${messagesDrafted} messages drafted, ${approvalsCreated} awaiting approval.`;
        log({
          actorType: 'agent',
          actor: 'orchestrator',
          action: 'run.summary',
          entityType: 'run',
          entityId: runId,
          runId,
          message: summaryLine,
          meta: { demo, source, query },
        });
        finishStep(stepId, { status: 'COMPLETED', output: { summary: summaryLine }, attempts: 1 });
        continue;
      }

      // ---- Unknown node ------------------------------------------------------
      const stepId = startStep({
        runId,
        seq,
        nodeId: node.id,
        label: node.label,
        kind: node.type,
        agentKey: node.agent ?? null,
        stepInput: (node.config ?? {}) as Record<string, unknown>,
      });
      finishStep(stepId, {
        status: 'SKIPPED',
        output: { reason: `No executor is registered for node type "${node.type}".` },
        attempts: 0,
      });
      warnings.push(`Node "${node.label}" was skipped: no executor for type "${node.type}".`);
    }

    const researchRunId = recordResearchRun({
      runId,
      country: input.country,
      city: input.city,
      area: input.area ?? '',
      category: input.category,
      source,
      demo,
      discovered: analysed.length + duplicates,
      imported,
      duplicates,
      createdBy: input.actor,
    });

    const status = approvalsCreated > 0 ? 'WAITING_APPROVAL' : 'COMPLETED';
    updateRun(runId, {
      status,
      context: {
        source,
        demo,
        query,
        imported,
        duplicates,
        qualified: analysed.filter((i) => i.qualified).length,
        messagesDrafted,
        approvalsCreated,
        leadIds: analysed.map((i) => i.lead?.id).filter(Boolean),
      },
    });

    return {
      runId,
      researchRunId,
      status,
      demo,
      source,
      query,
      notice,
      discovered: analysed.length + duplicates,
      imported,
      duplicates,
      qualified: analysed.filter((i) => i.qualified).length,
      messagesDrafted,
      approvalsCreated,
      leads: analysed.map((i) => i.lead).filter((l): l is Lead => Boolean(l)),
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown orchestration failure';
    updateRun(runId, { status: 'FAILED', error: message });
    log({
      level: 'error',
      actorType: 'agent',
      actor: 'orchestrator',
      action: 'run.failed',
      entityType: 'run',
      entityId: runId,
      runId,
      message: `Run failed: ${message}`,
    });
    throw error;
  }
}

interface RetryResult<T> {
  outcome: AgentOutcome<T> | null;
  attempts: number;
  error: string | null;
  validation: ValidationReport | null;
}

/**
 * Runs an agent, treating a failed blocking self-verification check as a
 * retryable failure. The orchestrator never accepts output an agent could not
 * validate.
 */
/** How many sites are fetched at once. Small enough to stay a polite visitor. */
const INSPECTION_CONCURRENCY = 4;

export interface VerificationSummary {
  candidates: number;
  inspected: number;
  reachable: number;
  unreachable: number;
  observationsAdded: number;
  contactsFound: number;
}

/**
 * Visits the websites of the businesses in a run and folds what was actually
 * found back into their observations.
 *
 * This is where unknowns become evidence: a discovery source can say a site is
 * listed, but only reading the site can show whether it takes bookings. A
 * business with no website is skipped entirely — there is nothing to look at,
 * and nothing may be concluded from that.
 */
export async function verifyWebsites(
  items: { business: DiscoveredBusiness }[],
  runId: string | null,
): Promise<VerificationSummary> {
  // Demo businesses carry sample URLs; fetching them would only prove the
  // sample domain does not exist, and would score a fictional business down.
  const candidates = items.filter((item) => item.business.website && !item.business.isDemo);
  const summary: VerificationSummary = {
    candidates: candidates.length,
    inspected: 0,
    reachable: 0,
    unreachable: 0,
    observationsAdded: 0,
    contactsFound: 0,
  };

  for (let i = 0; i < candidates.length; i += INSPECTION_CONCURRENCY) {
    const batch = candidates.slice(i, i + INSPECTION_CONCURRENCY);
    await Promise.all(
      batch.map(async (item) => {
        const business = item.business;
        const result = await inspectWebsite(business.website as string);
        summary.inspected += 1;
        if (result.failure) summary.unreachable += 1;
        else summary.reachable += 1;

        const added = Object.keys(result.observations).length;
        summary.observationsAdded += added;
        business.observations = { ...business.observations, ...result.observations };

        // Social profiles and a published email are observed facts, so they are
        // filled in only where the discovery source had nothing.
        const newSocials = Object.entries(result.socialLinks).filter(
          ([platform]) => !business.socialLinks?.[platform],
        );
        if (newSocials.length) {
          business.socialLinks = { ...business.socialLinks, ...Object.fromEntries(newSocials) };
          summary.contactsFound += newSocials.length;
        }
        if (!business.email && result.email) {
          business.email = result.email;
          summary.contactsFound += 1;
        }

        log({
          actorType: 'agent',
          actor: 'website_inspection',
          action: result.failure ? 'inspection.unreachable' : 'inspection.completed',
          runId,
          message: `${business.name}: ${result.evidence[0] ?? result.failure ?? 'nothing observed'}`,
          meta: { website: business.website, evidence: result.evidence, pagesRead: result.pagesRead },
        });
      }),
    );
  }

  return summary;
}

async function withRetry<T>(
  agentKey: string,
  fn: () => Promise<AgentOutcome<T>>,
): Promise<RetryResult<T>> {
  const config = getAgent(agentKey);
  const maxAttempts = Math.max(1, config.retryLimit + 1);
  let attempts = 0;
  let lastError: string | null = null;
  let lastValidation: ValidationReport | null = null;

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const result = await fn();
      lastValidation = result.validation;
      if (result.validation.passed) {
        return { outcome: result, attempts, error: null, validation: result.validation };
      }
      const failures = failedChecks(result.validation)
        .map((c) => `${c.name} (${c.detail})`)
        .join('; ');
      lastError = `Self-verification failed: ${failures}`;
      log({
        level: 'warn',
        actorType: 'agent',
        actor: agentKey,
        action: 'agent.validation_failed',
        message: `${agentKey} attempt ${attempts}/${maxAttempts}: ${lastError}`,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown agent error';
      log({
        level: 'warn',
        actorType: 'agent',
        actor: agentKey,
        action: 'agent.error',
        message: `${agentKey} attempt ${attempts}/${maxAttempts} threw: ${lastError}`,
      });
    }
  }

  return { outcome: null, attempts, error: lastError, validation: lastValidation };
}

function mergeReports(reports: ValidationReport[], failures: string[]): ValidationReport {
  const checkMap = new Map<string, { passed: number; failed: number; blocking: boolean; detail: string }>();
  for (const report of reports) {
    for (const check of report.checks) {
      const entry = checkMap.get(check.name) ?? {
        passed: 0,
        failed: 0,
        blocking: check.blocking,
        detail: check.detail,
      };
      if (check.passed) entry.passed += 1;
      else entry.failed += 1;
      checkMap.set(check.name, entry);
    }
  }

  return {
    passed: failures.length === 0 && Array.from(checkMap.values()).every((e) => !e.blocking || e.failed === 0),
    checks: Array.from(checkMap.entries()).map(([name, entry]) => ({
      name,
      passed: entry.failed === 0,
      blocking: entry.blocking,
      detail: `${entry.passed}/${entry.passed + entry.failed} items passed. ${entry.detail}`,
    })),
    warnings: [
      ...failures,
      ...Array.from(new Set(reports.flatMap((r) => r.warnings))).slice(0, 20),
    ],
  };
}

function evaluateCondition(config: ConditionConfig, item: AnalysedBusiness): boolean {
  const source: Record<string, unknown> = {
    leadScore: item.scoring?.score ?? 0,
    opportunityScore: item.opportunity?.score ?? 0,
    grade: item.scoring?.grade ?? 'C',
    estimatedValue: item.strategy?.estimatedValue ?? 0,
    confidence: item.opportunity?.confidence ?? 0,
    hasEmail: Boolean(item.business.email),
    hasPhone: Boolean(item.business.phone),
    recommendedService: item.strategy?.recommendedService ?? null,
  };

  const actual = source[config.field];
  const expected = config.value;

  switch (config.operator) {
    case '>=':
      return Number(actual) >= Number(expected);
    case '>':
      return Number(actual) > Number(expected);
    case '<=':
      return Number(actual) <= Number(expected);
    case '<':
      return Number(actual) < Number(expected);
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as never);
    case 'exists':
      return actual !== null && actual !== undefined && actual !== '';
    default:
      return false;
  }
}

export type { WorkflowNode };
