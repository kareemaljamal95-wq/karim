export type Role = 'admin' | 'operator' | 'analyst' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  active?: boolean;
  createdAt?: string;
}

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

export interface Signal {
  key: string;
  label: string;
  evidence: string;
  confidence: number;
  weight: number;
}

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
  leadGrade: 'A' | 'B' | 'C' | null;
  recommendedService: string | null;
  recommendedServiceLabel: string | null;
  reason: string | null;
  problem: string | null;
  estimatedValue: number | null;
  confidence: number | null;
  signals: Signal[];
  scoreBreakdown: Record<string, number | string[] | undefined> & { caveats?: string[] };
  status: LeadStatus;
  lastContactAt: string | null;
  nextAction: string | null;
  notes: string;
  source: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageQuality {
  mentionsBusinessName?: boolean;
  referencesEvidence?: boolean;
  disclosesAi?: boolean;
  spamPhrases?: string[];
  forbiddenClaims?: { phrase: string; reason: string }[];
  impersonation?: string[];
  withinLengthLimit?: boolean;
  score?: number;
}

export interface Message {
  id: string;
  leadId: string;
  leadName: string;
  channel: 'email' | 'whatsapp' | 'sms' | 'linkedin';
  subject: string | null;
  body: string;
  status: 'DRAFT' | 'APPROVAL_REQUIRED' | 'APPROVED' | 'REJECTED' | 'SENT' | 'FAILED';
  variant: string;
  quality: MessageQuality;
  generatedBy: string;
  editedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  sentAt: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  kind: string;
  title: string;
  summary: string;
  entityType: string;
  entityId: string;
  leadId: string | null;
  runId: string | null;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  lead?: Lead | null;
  messages?: Message[];
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  blocking: boolean;
  detail: string;
}

export interface ValidationReport {
  passed: boolean;
  checks: VerificationCheck[];
  warnings: string[];
}

export interface RunStep {
  id: string;
  seq: number;
  nodeId: string;
  label: string;
  agentKey: string | null;
  kind: string;
  status: string;
  attempts: number;
  input: Record<string, unknown>;
  output: unknown;
  validation: ValidationReport | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Run {
  id: string;
  workflowId: string | null;
  goal: string;
  status: string;
  context: Record<string, unknown>;
  plan: { nodeId: string; label: string; kind: string; agentKey: string | null }[];
  error: string | null;
  demo: boolean;
  startedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
  steps: RunStep[];
}

export interface AgentConfig {
  key: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  allowedActions: string[];
  requiresApproval: boolean;
  maxActions: number;
  retryLimit: number;
  outputFormat: string;
  enabled: boolean;
  isCore: boolean;
  updatedAt: string;
}

export interface ToolDescriptor {
  key: string;
  name: string;
  description: string;
  requires: string | null;
  available: boolean;
  hasDemoFallback: boolean;
}

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'agent' | 'tool' | 'condition' | 'approval' | 'action';
  label: string;
  agent?: string;
  tool?: string;
  description?: string;
  config?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  definition: { nodes: WorkflowNode[]; edges: { from: string; to: string; when?: 'pass' | 'fail' }[] };
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  leadId: string;
  leadName: string;
  title: string;
  service: string;
  requirements: string[];
  missingInformation: string[];
  status: string;
  estimatedValue: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationEntry {
  id: string;
  leadId: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  body: string;
  intent: string | null;
  sentiment: string | null;
  buyingSignals: string[];
  objections: string[];
  requirements: string[];
  requiresHuman: boolean;
  suggestedReply: string | null;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  actorType: 'user' | 'agent' | 'system';
  actor: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  runId: string | null;
  message: string;
  meta: Record<string, unknown>;
}

export interface SystemStatus {
  demoMode: boolean;
  liveDiscovery: boolean;
  liveReasoning: boolean;
  outboundSendingEnabled: boolean;
  pendingApprovals: number;
  demoLeads: number;
  liveLeads: number;
  launchBlockers: { key: string; title: string; detail: string }[];
}

export interface OverviewMetrics {
  totalLeads: number;
  contactableLeads: number;
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
  gradeCounts: { A: number; B: number; C: number };
}

export interface PlatformSettings {
  companyName: string;
  senderName: string;
  senderRole: string;
  replyToEmail: string;
  websiteUrl: string;
  approvedClaims: string[];
  offeredServices: string[];
  pricingPolicy: string;
  outboundSendingEnabled: boolean;
  requireApprovalForFirstContact: boolean;
  demoMode: boolean;
  defaultCountry: string;
  defaultCity: string;
  dailyOutreachCap: number;
}

export interface Integration {
  key: string;
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  fields: { key: string; label: string; secret: boolean; placeholder?: string }[];
  enabled: boolean;
  configured: boolean;
  fromEnv: boolean;
  credentialHints: Record<string, string>;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

export interface DiscoveryRunSummary {
  runId: string;
  status: string;
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
