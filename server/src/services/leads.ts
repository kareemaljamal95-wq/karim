import { bit, db, nowIso, parseJson, toJson, unbit } from '../db';
import { newId } from '../util/crypto';
import { badRequest, notFound } from '../util/errors';
import { dedupeKey, type DiscoveredBusiness } from '../domain/business';
import { serviceByKey } from '../domain/services';
import { LEAD_STATUSES, type LeadGrade, type LeadStatus, type Signal } from '../types';
import type { LeadScoreBreakdown } from '../domain/scoring';
import { log } from './logger';

export interface Lead {
  id: string;
  businessName: string;
  category: string;
  country: string;
  city: string;
  area: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  mapsUrl: string | null;
  socialLinks: Record<string, string>;
  rating: number | null;
  reviewCount: number | null;
  openingHours: string | null;
  opportunityScore: number | null;
  leadScore: number | null;
  leadGrade: LeadGrade | null;
  recommendedService: string | null;
  recommendedServiceLabel: string | null;
  reason: string | null;
  problem: string | null;
  estimatedValue: number | null;
  confidence: number | null;
  signals: Signal[];
  scoreBreakdown: Partial<LeadScoreBreakdown> & { caveats?: string[] };
  status: LeadStatus;
  lastContactAt: string | null;
  nextAction: string | null;
  notes: string;
  source: string;
  isDemo: boolean;
  researchRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapLead(row: Record<string, unknown>): Lead {
  const serviceKey = (row.recommended_service as string) ?? null;
  return {
    id: String(row.id),
    businessName: String(row.business_name),
    category: String(row.category),
    country: String(row.country ?? ''),
    city: String(row.city ?? ''),
    area: String(row.area ?? ''),
    address: (row.address as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    website: (row.website as string) ?? null,
    mapsUrl: (row.maps_url as string) ?? null,
    socialLinks: parseJson<Record<string, string>>(row.social_links, {}),
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    reviewCount:
      row.review_count === null || row.review_count === undefined ? null : Number(row.review_count),
    openingHours: (row.opening_hours as string) ?? null,
    opportunityScore:
      row.opportunity_score === null || row.opportunity_score === undefined
        ? null
        : Number(row.opportunity_score),
    leadScore: row.lead_score === null || row.lead_score === undefined ? null : Number(row.lead_score),
    leadGrade: (row.lead_grade as LeadGrade) ?? null,
    recommendedService: serviceKey,
    recommendedServiceLabel: serviceKey ? (serviceByKey(serviceKey)?.label ?? serviceKey) : null,
    reason: (row.reason as string) ?? null,
    problem: (row.problem as string) ?? null,
    estimatedValue:
      row.estimated_value === null || row.estimated_value === undefined
        ? null
        : Number(row.estimated_value),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    signals: parseJson<Signal[]>(row.signals, []),
    scoreBreakdown: parseJson<Lead['scoreBreakdown']>(row.score_breakdown, {}),
    status: row.status as LeadStatus,
    lastContactAt: (row.last_contact_at as string) ?? null,
    nextAction: (row.next_action as string) ?? null,
    notes: String(row.notes ?? ''),
    source: String(row.source ?? 'demo'),
    isDemo: unbit(row.is_demo),
    researchRunId: (row.research_run_id as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export interface LeadUpsertInput {
  business: DiscoveredBusiness;
  analysis?: {
    opportunityScore: number;
    confidence: number;
    signals: Signal[];
    problem: string;
    reason: string;
    recommendedService: string | null;
    estimatedValue: number;
    leadScore: number;
    leadGrade: LeadGrade;
    scoreBreakdown: Lead['scoreBreakdown'];
    nextAction: string;
  };
  researchRunId?: string | null;
  status?: LeadStatus;
}

export interface UpsertResult {
  lead: Lead;
  created: boolean;
}

/**
 * Writes discovered detail and a fresh analysis onto an existing lead.
 *
 * COALESCE throughout means a re-run can only add or refresh: a value the
 * source no longer returns never wipes one already recorded, and the lead's
 * status — which a human may have moved on — is not touched here at all.
 */
export function writeAnalysis(
  id: string,
  b: DiscoveredBusiness,
  a: LeadUpsertInput['analysis'],
): void {
  db()
    .prepare(
      `UPDATE leads SET
         phone = COALESCE(@phone, phone),
         email = COALESCE(@email, email),
         website = COALESCE(@website, website),
         maps_url = COALESCE(@maps_url, maps_url),
         rating = COALESCE(@rating, rating),
         review_count = COALESCE(@review_count, review_count),
         opening_hours = COALESCE(@opening_hours, opening_hours),
         social_links = @social_links,
         opportunity_score = COALESCE(@opportunity_score, opportunity_score),
         lead_score = COALESCE(@lead_score, lead_score),
         lead_grade = COALESCE(@lead_grade, lead_grade),
         recommended_service = COALESCE(@recommended_service, recommended_service),
         reason = COALESCE(@reason, reason),
         problem = COALESCE(@problem, problem),
         estimated_value = COALESCE(@estimated_value, estimated_value),
         confidence = COALESCE(@confidence, confidence),
         signals = COALESCE(@signals, signals),
         score_breakdown = COALESCE(@score_breakdown, score_breakdown),
         next_action = COALESCE(@next_action, next_action),
         updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      phone: b.phone ?? null,
      email: b.email ?? null,
      website: b.website ?? null,
      maps_url: b.mapsUrl ?? null,
      rating: b.rating ?? null,
      review_count: b.reviewCount ?? null,
      opening_hours: b.openingHours ?? null,
      social_links: toJson(b.socialLinks ?? {}),
      opportunity_score: a?.opportunityScore ?? null,
      lead_score: a?.leadScore ?? null,
      lead_grade: a?.leadGrade ?? null,
      recommended_service: a?.recommendedService ?? null,
      reason: a?.reason ?? null,
      problem: a?.problem ?? null,
      estimated_value: a?.estimatedValue ?? null,
      confidence: a?.confidence ?? null,
      signals: a ? toJson(a.signals) : null,
      score_breakdown: a ? toJson(a.scoreBreakdown) : null,
      next_action: a?.nextAction ?? null,
      updated_at: nowIso(),
    });
}

/**
 * Inserts a discovered business, or refreshes the analysis on an existing one.
 *
 * Deduplication is enforced by a unique key derived from the strongest
 * identifier available (external id → phone → domain → name+city), so repeated
 * research runs never create duplicate leads.
 */
export function upsertLead(input: LeadUpsertInput): UpsertResult {
  const key = dedupeKey(input.business);
  const existing = db().prepare('SELECT * FROM leads WHERE dedupe_key = ?').get(key) as
    | Record<string, unknown>
    | undefined;
  const now = nowIso();
  const b = input.business;
  const a = input.analysis;

  if (existing) {
    // Refresh analysis and any newly-discovered public detail, but never
    // downgrade a status a human has already moved forward.
    writeAnalysis(String(existing.id), b, a);
    return { lead: getLead(String(existing.id)), created: false };
  }

  const id = newId();
  db()
    .prepare(
      `INSERT INTO leads (
         id, business_name, category, country, city, area, address, phone, email, website, maps_url,
         social_links, rating, review_count, opening_hours, opportunity_score, lead_score, lead_grade,
         recommended_service, reason, problem, estimated_value, confidence, signals, score_breakdown,
         status, next_action, notes, source, is_demo, dedupe_key, research_run_id, created_at, updated_at
       ) VALUES (
         @id, @business_name, @category, @country, @city, @area, @address, @phone, @email, @website, @maps_url,
         @social_links, @rating, @review_count, @opening_hours, @opportunity_score, @lead_score, @lead_grade,
         @recommended_service, @reason, @problem, @estimated_value, @confidence, @signals, @score_breakdown,
         @status, @next_action, @notes, @source, @is_demo, @dedupe_key, @research_run_id, @created_at, @updated_at
       )`,
    )
    .run({
      id,
      business_name: b.name,
      category: b.category,
      country: b.country,
      city: b.city,
      area: b.area,
      address: b.address ?? null,
      phone: b.phone ?? null,
      email: b.email ?? null,
      website: b.website ?? null,
      maps_url: b.mapsUrl ?? null,
      social_links: toJson(b.socialLinks ?? {}),
      rating: b.rating ?? null,
      review_count: b.reviewCount ?? null,
      opening_hours: b.openingHours ?? null,
      opportunity_score: a?.opportunityScore ?? null,
      lead_score: a?.leadScore ?? null,
      lead_grade: a?.leadGrade ?? null,
      recommended_service: a?.recommendedService ?? null,
      reason: a?.reason ?? null,
      problem: a?.problem ?? null,
      estimated_value: a?.estimatedValue ?? null,
      confidence: a?.confidence ?? null,
      signals: toJson(a?.signals ?? []),
      score_breakdown: toJson(a?.scoreBreakdown ?? {}),
      status: input.status ?? (a ? 'QUALIFIED' : 'NEW'),
      next_action: a?.nextAction ?? null,
      notes: '',
      source: b.source,
      is_demo: bit(b.isDemo),
      dedupe_key: key,
      research_run_id: input.researchRunId ?? null,
      created_at: now,
      updated_at: now,
    });

  return { lead: getLead(id), created: true };
}

export interface LeadQuery {
  status?: LeadStatus;
  grade?: LeadGrade;
  city?: string;
  category?: string;
  service?: string;
  minScore?: number;
  search?: string;
  demoOnly?: boolean;
  liveOnly?: boolean;
  sort?: 'score' | 'created' | 'updated' | 'value';
  limit?: number;
  offset?: number;
}

export function listLeads(query: LeadQuery = {}): { items: Lead[]; total: number } {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.status) {
    where.push('status = @status');
    params.status = query.status;
  }
  if (query.grade) {
    where.push('lead_grade = @grade');
    params.grade = query.grade;
  }
  if (query.city) {
    where.push('city = @city');
    params.city = query.city;
  }
  if (query.category) {
    where.push('category = @category');
    params.category = query.category;
  }
  if (query.service) {
    where.push('recommended_service = @service');
    params.service = query.service;
  }
  if (query.minScore !== undefined) {
    where.push('COALESCE(lead_score, 0) >= @minScore');
    params.minScore = query.minScore;
  }
  if (query.demoOnly) where.push('is_demo = 1');
  if (query.liveOnly) where.push('is_demo = 0');
  if (query.search) {
    where.push('(business_name LIKE @search OR category LIKE @search OR city LIKE @search OR email LIKE @search)');
    params.search = `%${query.search}%`;
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order =
    query.sort === 'created'
      ? 'created_at DESC'
      : query.sort === 'updated'
        ? 'updated_at DESC'
        : query.sort === 'value'
          ? 'COALESCE(estimated_value, 0) DESC'
          : 'COALESCE(lead_score, 0) DESC, COALESCE(opportunity_score, 0) DESC';

  const limit = Math.min(query.limit ?? 50, 500);
  const offset = query.offset ?? 0;

  const total = (db().prepare(`SELECT COUNT(*) AS c FROM leads ${clause}`).get(params) as { c: number }).c;
  const rows = db()
    .prepare(`SELECT * FROM leads ${clause} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as Record<string, unknown>[];

  return { items: rows.map(mapLead), total };
}

export function getLead(id: string): Lead {
  const row = db().prepare('SELECT * FROM leads WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw notFound('Lead not found');
  return mapLead(row);
}

export function findLead(id: string): Lead | null {
  const row = db().prepare('SELECT * FROM leads WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapLead(row) : null;
}

export interface LeadPatch {
  status?: LeadStatus;
  notes?: string;
  nextAction?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  recommendedService?: string | null;
  estimatedValue?: number | null;
  lastContactAt?: string | null;
}

export function updateLead(id: string, patch: LeadPatch, actor: string): Lead {
  const before = getLead(id);
  if (patch.status && !LEAD_STATUSES.includes(patch.status)) {
    throw badRequest(`Unknown lead status "${patch.status}"`);
  }
  if (patch.recommendedService && !serviceByKey(patch.recommendedService)) {
    throw badRequest(`Unknown service "${patch.recommendedService}"`);
  }

  db()
    .prepare(
      `UPDATE leads SET
         status = COALESCE(@status, status),
         notes = COALESCE(@notes, notes),
         next_action = CASE WHEN @next_action_set = 1 THEN @next_action ELSE next_action END,
         email = CASE WHEN @email_set = 1 THEN @email ELSE email END,
         phone = CASE WHEN @phone_set = 1 THEN @phone ELSE phone END,
         website = CASE WHEN @website_set = 1 THEN @website ELSE website END,
         recommended_service = COALESCE(@recommended_service, recommended_service),
         estimated_value = COALESCE(@estimated_value, estimated_value),
         last_contact_at = COALESCE(@last_contact_at, last_contact_at),
         updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      status: patch.status ?? null,
      notes: patch.notes ?? null,
      next_action: patch.nextAction ?? null,
      next_action_set: patch.nextAction === undefined ? 0 : 1,
      email: patch.email ?? null,
      email_set: patch.email === undefined ? 0 : 1,
      phone: patch.phone ?? null,
      phone_set: patch.phone === undefined ? 0 : 1,
      website: patch.website ?? null,
      website_set: patch.website === undefined ? 0 : 1,
      recommended_service: patch.recommendedService ?? null,
      estimated_value: patch.estimatedValue ?? null,
      last_contact_at: patch.lastContactAt ?? null,
      updated_at: nowIso(),
    });

  const after = getLead(id);
  if (patch.status && patch.status !== before.status) {
    log({
      actorType: 'user',
      actor,
      action: 'lead.status_changed',
      entityType: 'lead',
      entityId: id,
      message: `${after.businessName}: ${before.status} → ${after.status}`,
      meta: { from: before.status, to: after.status },
    });
  }
  return after;
}

export function setLeadStatus(id: string, status: LeadStatus, actor: string, reason?: string): Lead {
  const lead = updateLead(id, { status }, actor);
  if (reason) {
    log({
      actorType: 'system',
      actor,
      action: 'lead.status_reason',
      entityType: 'lead',
      entityId: id,
      message: reason,
    });
  }
  return lead;
}

export function deleteLead(id: string, actor: string): void {
  const lead = getLead(id);
  db().prepare('DELETE FROM leads WHERE id = ?').run(id);
  log({
    level: 'warn',
    actorType: 'user',
    actor,
    action: 'lead.deleted',
    entityType: 'lead',
    entityId: id,
    message: `Lead "${lead.businessName}" deleted`,
  });
}

export interface DemoPurge {
  leads: number;
  messages: number;
  approvals: number;
}

/**
 * Removes every demo record and everything attached to it.
 *
 * Demo data exists so an operator can learn the pipeline before real leads
 * arrive. Once they have, it becomes noise in the very queues that decide what
 * gets sent — an approvals list of samples is a list nobody reads carefully.
 * Live records are never touched, and the counts are returned so the caller can
 * report exactly what went.
 */
export function purgeDemoData(actor: string): DemoPurge {
  const leadIds = (db().prepare('SELECT id FROM leads WHERE is_demo = 1').all() as { id: string }[]).map(
    (row) => row.id,
  );
  if (!leadIds.length) return { leads: 0, messages: 0, approvals: 0 };

  const placeholders = leadIds.map(() => '?').join(',');
  const messageIds = (
    db().prepare(`SELECT id FROM messages WHERE lead_id IN (${placeholders})`).all(...leadIds) as {
      id: string;
    }[]
  ).map((row) => row.id);

  // Approvals point at their subject by id rather than by foreign key, so they
  // would outlive the record they belong to.
  const entityIds = [...leadIds, ...messageIds];
  const approvalPlaceholders = entityIds.map(() => '?').join(',');
  const approvals = db()
    .prepare(`DELETE FROM approvals WHERE entity_id IN (${approvalPlaceholders})`)
    .run(...entityIds).changes;

  // Messages, conversations and projects cascade from the lead row.
  const leads = db().prepare(`DELETE FROM leads WHERE id IN (${placeholders})`).run(...leadIds).changes;

  log({
    actorType: 'user',
    actor,
    action: 'demo.purged',
    message: `Removed ${leads} demo lead(s), ${messageIds.length} message(s) and ${approvals} approval(s)`,
  });

  return { leads, messages: messageIds.length, approvals };
}

export function leadFilterOptions(): {
  cities: string[];
  categories: string[];
  services: string[];
} {
  // Single quotes: SQLite reads "" as an identifier, so the double-quoted form
  // fails with `no such column: ""` as soon as the query actually runs.
  const cities = (db().prepare("SELECT DISTINCT city FROM leads WHERE city != '' ORDER BY city").all() as {
    city: string;
  }[]).map((r) => r.city);
  const categories = (
    db().prepare('SELECT DISTINCT category FROM leads ORDER BY category').all() as { category: string }[]
  ).map((r) => r.category);
  const services = (
    db()
      .prepare('SELECT DISTINCT recommended_service FROM leads WHERE recommended_service IS NOT NULL')
      .all() as { recommended_service: string }[]
  ).map((r) => r.recommended_service);
  return { cities, categories, services };
}

const CSV_COLUMNS: { header: string; value: (l: Lead) => string | number | null }[] = [
  { header: 'ID', value: (l) => l.id },
  { header: 'Business Name', value: (l) => l.businessName },
  { header: 'Category', value: (l) => l.category },
  { header: 'City', value: (l) => l.city },
  { header: 'Area', value: (l) => l.area },
  { header: 'Country', value: (l) => l.country },
  { header: 'Phone', value: (l) => l.phone },
  { header: 'Email', value: (l) => l.email },
  { header: 'Website', value: (l) => l.website },
  { header: 'Maps URL', value: (l) => l.mapsUrl },
  { header: 'Social Links', value: (l) => Object.values(l.socialLinks).join(' | ') },
  { header: 'Rating', value: (l) => l.rating },
  { header: 'Reviews', value: (l) => l.reviewCount },
  { header: 'Opportunity Score', value: (l) => l.opportunityScore },
  { header: 'Lead Score', value: (l) => l.leadScore },
  { header: 'Lead Grade', value: (l) => l.leadGrade },
  { header: 'Recommended Service', value: (l) => l.recommendedServiceLabel },
  { header: 'Reason', value: (l) => l.reason },
  { header: 'Estimated Value', value: (l) => l.estimatedValue },
  { header: 'Status', value: (l) => l.status },
  { header: 'Last Contact', value: (l) => l.lastContactAt },
  { header: 'Next Action', value: (l) => l.nextAction },
  { header: 'Notes', value: (l) => l.notes },
  { header: 'Data Source', value: (l) => (l.isDemo ? 'DEMO DATA' : l.source) },
  { header: 'Created At', value: (l) => l.createdAt },
  { header: 'Updated At', value: (l) => l.updatedAt },
];

export function leadsToCsv(leads: Lead[]): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = CSV_COLUMNS.map((c) => c.header).join(',');
  const rows = leads.map((lead) => CSV_COLUMNS.map((c) => escape(c.value(lead))).join(','));
  return [header, ...rows].join('\n');
}
