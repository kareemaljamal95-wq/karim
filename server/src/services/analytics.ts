import { db } from '../db';
import { serviceByKey } from '../domain/services';
import { getSettings } from './settings';
import { llmAvailable } from '../llm/provider';
import { isHealthy, lastIntegrationError } from './integrations';
import { emailDeliveryAvailable } from '../tools/emailDelivery';
import { env } from '../config/env';
import type { PlatformSettings } from './settings';
import { googlePlacesAvailable } from '../tools/googlePlaces';
import { openStreetMapAvailable } from '../tools/openStreetMap';

export interface OverviewMetrics {
  totalLeads: number;
  qualifiedLeads: number;
  highOpportunityLeads: number;
  pendingApprovals: number;
  messagesDrafted: number;
  messagesSent: number;
  replies: number;
  interestedLeads: number;
  wonDeals: number;
  estimatedPipelineValue: number;
  demoLeads: number;
  liveLeads: number;
  /** Live leads with an email or a phone — the ones outreach can actually reach. */
  contactableLeads: number;
  gradeCounts: { A: number; B: number; C: number };
}

const scalar = (sql: string, params: unknown[] = []): number => {
  const row = db().prepare(sql).get(...params) as Record<string, number | null> | undefined;
  if (!row) return 0;
  const value = Object.values(row)[0];
  return value === null || value === undefined ? 0 : Number(value);
};

export function overviewMetrics(): OverviewMetrics {
  return {
    totalLeads: scalar('SELECT COUNT(*) AS c FROM leads'),
    qualifiedLeads: scalar(
      `SELECT COUNT(*) AS c FROM leads WHERE status IN ('QUALIFIED','APPROVAL_REQUIRED','CONTACTED','REPLIED','INTERESTED','NEGOTIATING','WON')`,
    ),
    highOpportunityLeads: scalar('SELECT COUNT(*) AS c FROM leads WHERE COALESCE(opportunity_score,0) >= 70'),
    pendingApprovals: scalar(`SELECT COUNT(*) AS c FROM approvals WHERE status = 'PENDING'`),
    messagesDrafted: scalar('SELECT COUNT(*) AS c FROM messages'),
    messagesSent: scalar(`SELECT COUNT(*) AS c FROM messages WHERE status = 'SENT'`),
    replies: scalar(`SELECT COUNT(*) AS c FROM conversations WHERE direction = 'inbound'`),
    interestedLeads: scalar(`SELECT COUNT(*) AS c FROM leads WHERE status IN ('INTERESTED','NEGOTIATING')`),
    wonDeals: scalar(`SELECT COUNT(*) AS c FROM leads WHERE status = 'WON'`),
    estimatedPipelineValue: scalar(
      `SELECT COALESCE(SUM(estimated_value),0) AS v FROM leads
       WHERE status IN ('QUALIFIED','APPROVAL_REQUIRED','CONTACTED','REPLIED','INTERESTED','NEGOTIATING')`,
    ),
    demoLeads: scalar('SELECT COUNT(*) AS c FROM leads WHERE is_demo = 1'),
    liveLeads: scalar('SELECT COUNT(*) AS c FROM leads WHERE is_demo = 0'),
    contactableLeads: scalar(
      "SELECT COUNT(*) AS c FROM leads WHERE is_demo = 0 AND (COALESCE(email, '') <> '' OR COALESCE(phone, '') <> '')",
    ),
    gradeCounts: {
      A: scalar(`SELECT COUNT(*) AS c FROM leads WHERE lead_grade = 'A'`),
      B: scalar(`SELECT COUNT(*) AS c FROM leads WHERE lead_grade = 'B'`),
      C: scalar(`SELECT COUNT(*) AS c FROM leads WHERE lead_grade = 'C'`),
    },
  };
}

export interface AnalyticsBundle {
  metrics: OverviewMetrics;
  funnel: { stage: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byGrade: { grade: string; count: number; value: number }[];
  byService: { service: string; label: string; count: number; value: number }[];
  byCity: { city: string; count: number; avgScore: number }[];
  byCategory: { category: string; count: number; avgScore: number }[];
  scoreDistribution: { bucket: string; count: number }[];
  activityByDay: { date: string; leads: number; messages: number; approvals: number }[];
  conversion: {
    contactedToReplied: number;
    repliedToInterested: number;
    interestedToWon: number;
  };
  dataQuality: {
    withEmail: number;
    withPhone: number;
    withWebsite: number;
    withoutContact: number;
    total: number;
  };
}

const FUNNEL_STAGES: { stage: string; statuses: string[] }[] = [
  { stage: 'Discovered', statuses: ['NEW', 'RESEARCHING', 'QUALIFIED', 'APPROVAL_REQUIRED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'NEGOTIATING', 'WON', 'LOST', 'NOT_A_FIT'] },
  { stage: 'Qualified', statuses: ['QUALIFIED', 'APPROVAL_REQUIRED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'NEGOTIATING', 'WON'] },
  { stage: 'Approved / contacted', statuses: ['CONTACTED', 'REPLIED', 'INTERESTED', 'NEGOTIATING', 'WON'] },
  { stage: 'Replied', statuses: ['REPLIED', 'INTERESTED', 'NEGOTIATING', 'WON'] },
  { stage: 'Interested', statuses: ['INTERESTED', 'NEGOTIATING', 'WON'] },
  { stage: 'Won', statuses: ['WON'] },
];

export function analyticsBundle(): AnalyticsBundle {
  const metrics = overviewMetrics();

  const funnel = FUNNEL_STAGES.map(({ stage, statuses }) => ({
    stage,
    count: scalar(
      `SELECT COUNT(*) AS c FROM leads WHERE status IN (${statuses.map(() => '?').join(',')})`,
      statuses,
    ),
  }));

  const byStatus = (
    db().prepare('SELECT status, COUNT(*) AS count FROM leads GROUP BY status').all() as {
      status: string;
      count: number;
    }[]
  ).map((r) => ({ status: r.status, count: r.count }));

  const byGrade = (
    db()
      .prepare(
        `SELECT COALESCE(lead_grade,'Unscored') AS grade, COUNT(*) AS count,
                COALESCE(SUM(estimated_value),0) AS value
         FROM leads GROUP BY COALESCE(lead_grade,'Unscored') ORDER BY grade`,
      )
      .all() as { grade: string; count: number; value: number }[]
  ).map((r) => ({ grade: r.grade, count: r.count, value: r.value }));

  const byService = (
    db()
      .prepare(
        `SELECT recommended_service AS service, COUNT(*) AS count, COALESCE(SUM(estimated_value),0) AS value
         FROM leads WHERE recommended_service IS NOT NULL
         GROUP BY recommended_service ORDER BY count DESC`,
      )
      .all() as { service: string; count: number; value: number }[]
  ).map((r) => ({
    service: r.service,
    label: serviceByKey(r.service)?.label ?? r.service,
    count: r.count,
    value: r.value,
  }));

  const byCity = (
    db()
      .prepare(
        `SELECT city, COUNT(*) AS count, COALESCE(AVG(opportunity_score),0) AS avgScore
         FROM leads WHERE city != '' GROUP BY city ORDER BY count DESC LIMIT 12`,
      )
      .all() as { city: string; count: number; avgScore: number }[]
  ).map((r) => ({ city: r.city, count: r.count, avgScore: Math.round(r.avgScore) }));

  const byCategory = (
    db()
      .prepare(
        `SELECT category, COUNT(*) AS count, COALESCE(AVG(opportunity_score),0) AS avgScore
         FROM leads GROUP BY category ORDER BY count DESC LIMIT 12`,
      )
      .all() as { category: string; count: number; avgScore: number }[]
  ).map((r) => ({ category: r.category, count: r.count, avgScore: Math.round(r.avgScore) }));

  const buckets = [
    { bucket: '0-19', min: 0, max: 19 },
    { bucket: '20-39', min: 20, max: 39 },
    { bucket: '40-59', min: 40, max: 59 },
    { bucket: '60-74', min: 60, max: 74 },
    { bucket: '75-89', min: 75, max: 89 },
    { bucket: '90-100', min: 90, max: 100 },
  ];
  const scoreDistribution = buckets.map(({ bucket, min, max }) => ({
    bucket,
    count: scalar(
      'SELECT COUNT(*) AS c FROM leads WHERE COALESCE(lead_score,0) BETWEEN ? AND ?',
      [min, max],
    ),
  }));

  const days = lastNDays(14);
  const activityByDay = days.map((date) => ({
    date,
    leads: scalar('SELECT COUNT(*) AS c FROM leads WHERE substr(created_at,1,10) = ?', [date]),
    messages: scalar('SELECT COUNT(*) AS c FROM messages WHERE substr(created_at,1,10) = ?', [date]),
    approvals: scalar('SELECT COUNT(*) AS c FROM approvals WHERE substr(created_at,1,10) = ?', [date]),
  }));

  const contacted = scalar(
    `SELECT COUNT(*) AS c FROM leads WHERE status IN ('CONTACTED','REPLIED','INTERESTED','NEGOTIATING','WON')`,
  );
  const replied = scalar(
    `SELECT COUNT(*) AS c FROM leads WHERE status IN ('REPLIED','INTERESTED','NEGOTIATING','WON')`,
  );
  const interested = scalar(
    `SELECT COUNT(*) AS c FROM leads WHERE status IN ('INTERESTED','NEGOTIATING','WON')`,
  );
  const won = scalar(`SELECT COUNT(*) AS c FROM leads WHERE status = 'WON'`);

  const rate = (numerator: number, denominator: number): number =>
    denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);

  return {
    metrics,
    funnel,
    byStatus,
    byGrade,
    byService,
    byCity,
    byCategory,
    scoreDistribution,
    activityByDay,
    conversion: {
      contactedToReplied: rate(replied, contacted),
      repliedToInterested: rate(interested, replied),
      interestedToWon: rate(won, interested),
    },
    dataQuality: {
      withEmail: scalar(`SELECT COUNT(*) AS c FROM leads WHERE email IS NOT NULL AND email != ''`),
      withPhone: scalar(`SELECT COUNT(*) AS c FROM leads WHERE phone IS NOT NULL AND phone != ''`),
      withWebsite: scalar(`SELECT COUNT(*) AS c FROM leads WHERE website IS NOT NULL AND website != ''`),
      withoutContact: scalar(
        `SELECT COUNT(*) AS c FROM leads WHERE (email IS NULL OR email = '') AND (phone IS NULL OR phone = '')`,
      ),
      total: metrics.totalLeads,
    },
  };
}

function lastNDays(count: number): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - i);
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

export interface SystemStatus {
  demoMode: boolean;
  liveDiscovery: boolean;
  liveReasoning: boolean;
  outboundSendingEnabled: boolean;
  pendingApprovals: number;
  demoLeads: number;
  liveLeads: number;
  /** Everything still standing between the platform and its first real send. */
  launchBlockers: { key: string; title: string; detail: string }[];
}

/**
 * What is missing before outreach can actually reach a business.
 *
 * Each entry is a fact about this deployment, not advice: an operator can read
 * it and know exactly what remains, without asking anyone.
 */
function launchBlockers(settings: PlatformSettings): SystemStatus['launchBlockers'] {
  const blockers: SystemStatus['launchBlockers'] = [];

  if (!emailDeliveryAvailable()) {
    blockers.push({
      key: 'email_transport',
      title: 'No email transport is connected',
      detail:
        'Connect Resend (delivers over HTTPS, works on hosts that block SMTP ports) or the SMTP connector in Integrations. Without one, an approved message stays queued.',
    });
  } else if (!isHealthy('resend') && !isHealthy('gmail')) {
    // Connected is not the same as working: a host that blocks SMTP ports
    // leaves the connector switched on while every attempt times out.
    const reason = lastIntegrationError('resend') ?? lastIntegrationError('gmail') ?? 'the last attempt failed';
    blockers.push({
      key: 'email_transport_failing',
      title: 'The connected email transport is failing',
      detail: `${reason} Use Test connection in Integrations after fixing it.`,
    });
  }
  if (!env.outboundSendingEnabled) {
    blockers.push({
      key: 'environment_switch',
      title: 'Sending is disabled in the environment',
      detail: 'Set OUTBOUND_SENDING_ENABLED=true where the app is deployed, then redeploy.',
    });
  }
  if (!settings.outboundSendingEnabled) {
    blockers.push({
      key: 'settings_switch',
      title: 'Sending is switched off in Settings',
      detail: 'Turn on outbound sending in Settings once you have tested a message to yourself.',
    });
  }
  if (!settings.companyName.trim() || settings.companyName === 'Your Agency' || !settings.senderName.trim()) {
    blockers.push({
      key: 'identity',
      title: 'Company identity is incomplete',
      detail: 'Fill in the company and sender name in Settings — both appear in every message.',
    });
  }
  if (overviewMetrics().contactableLeads === 0) {
    blockers.push({
      key: 'contactable_leads',
      title: 'No lead has a way to contact it',
      detail:
        'Run market research, or add a website to a lead and use Verify website to find a published address.',
    });
  }

  return blockers;
}

/** Powers the persistent "what is real vs demo" banner in the dashboard. */
export function systemStatus(): SystemStatus {
  const settings = getSettings();
  const metrics = overviewMetrics();
  const liveDiscovery = googlePlacesAvailable() || openStreetMapAvailable();
  return {
    // Either discovery source counts as live: what makes a run "demo" is that
    // no real source is connected, not which one it is.
    demoMode: !liveDiscovery,
    liveDiscovery,
    // Configured is not enough — a key with no credit fails every call.
    liveReasoning: llmAvailable() && isHealthy('anthropic'),
    outboundSendingEnabled: settings.outboundSendingEnabled,
    pendingApprovals: metrics.pendingApprovals,
    demoLeads: metrics.demoLeads,
    liveLeads: metrics.liveLeads,
    launchBlockers: launchBlockers(settings),
  };
}
