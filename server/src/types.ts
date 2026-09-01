export type Role = 'admin' | 'operator' | 'analyst' | 'viewer';

export const ROLES: Role[] = ['admin', 'operator', 'analyst', 'viewer'];

/** Ordered by privilege; index is used for hierarchical checks. */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  analyst: 1,
  operator: 2,
  admin: 3,
};

export type LeadStatus =
  | 'NEW'
  | 'RESEARCHING'
  | 'QUALIFIED'
  | 'APPROVAL_REQUIRED'
  | 'CONTACTED'
  | 'REPLIED'
  | 'INTERESTED'
  | 'NEGOTIATING'
  | 'WON'
  | 'LOST'
  | 'NOT_A_FIT';

export const LEAD_STATUSES: LeadStatus[] = [
  'NEW',
  'RESEARCHING',
  'QUALIFIED',
  'APPROVAL_REQUIRED',
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'NEGOTIATING',
  'WON',
  'LOST',
  'NOT_A_FIT',
];

export type LeadGrade = 'A' | 'B' | 'C';

export type ServiceKey =
  | 'ai_customer_service_agent'
  | 'whatsapp_website_ai_assistant'
  | 'website'
  | 'mobile_application'
  | 'booking_system'
  | 'ordering_system'
  | 'crm'
  | 'lead_generation_system'
  | 'ai_marketing_automation'
  | 'social_media_automation'
  | 'custom_ai_agent'
  | 'internal_business_automation';

export interface ServiceDefinition {
  key: ServiceKey;
  label: string;
  /** Signals that must be present for this service to be recommendable. */
  requiredSignals: SignalKey[];
  /** Typical project value band in USD, used for estimates (never invented per-lead). */
  valueBand: { low: number; high: number };
  summary: string;
}

export type SignalKey =
  | 'no_website'
  | 'poor_website'
  | 'no_mobile_app'
  | 'no_online_ordering'
  | 'poor_online_ordering'
  | 'no_booking_system'
  | 'weak_customer_communication'
  | 'no_automation'
  | 'poor_social_presence'
  | 'repetitive_service_load'
  | 'high_customer_activity'
  | 'large_review_volume'
  | 'low_rating'
  | 'no_public_email'
  | 'stale_listing';

export interface Signal {
  key: SignalKey;
  label: string;
  /** Human-readable statement of the observed evidence backing this signal. */
  evidence: string;
  /** 0..1 — how confident the analyst is that the signal is real. */
  confidence: number;
  weight: number;
}

export type MessageChannel = 'email' | 'whatsapp' | 'sms' | 'linkedin';

export type MessageStatus =
  | 'DRAFT'
  | 'APPROVAL_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'
  | 'FAILED';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type ApprovalKind =
  | 'FIRST_OUTREACH'
  | 'COMMERCIAL_COMMITMENT'
  | 'PRICE_AGREEMENT'
  | 'PROJECT_ACCEPTANCE'
  | 'DELIVERABLE_SEND'
  | 'IRREVERSIBLE_ACTION';

export type RunStatus = 'PENDING' | 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type StepStatus = 'PENDING' | 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
