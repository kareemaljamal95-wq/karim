import { useState } from 'react';
import { Plus, Save, ShieldAlert, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery, useSystemStatus } from '../lib/hooks';
import { dateOnly } from '../lib/format';
import {
  Badge,
  Card,
  ErrorBlock,
  Field,
  InfoNote,
  LoadingBlock,
  Modal,
  PageHeader,
  SectionTitle,
  Spinner,
  TableWrap,
  Td,
  Th,
  Toggle,
} from '../components/ui';
import type { PlatformSettings, User } from '../lib/types';

interface SettingsResponse {
  settings: PlatformSettings;
}

interface CatalogResponse {
  services: { key: string; label: string; summary: string }[];
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Full access, including agents, workflows, integrations and team.',
  operator: 'Approve, reject and send messages; edit leads and projects.',
  analyst: 'Run research and generate drafts; cannot approve or send.',
  viewer: 'Read-only access to everything.',
};

export function SettingsPage() {
  const { can } = useAuth();
  const { status, refresh } = useSystemStatus();
  const { run, pending } = useAction();
  const { data, loading, error, refetch } = useQuery<SettingsResponse>('/system/settings');
  const { data: catalog } = useQuery<CatalogResponse>('/system/catalog');
  const [draft, setDraft] = useState<PlatformSettings | null>(null);

  if (loading) return <LoadingBlock label="Loading settings" />;
  if (error) return <ErrorBlock message={error} onRetry={refetch} />;
  if (!data) return null;

  const settings = draft ?? data.settings;
  const update = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) =>
    setDraft({ ...settings, [key]: value });

  const save = async () => {
    if (!draft) return;
    const result = await run(
      () =>
        api('/system/settings', {
          method: 'PATCH',
          body: {
            companyName: draft.companyName,
            senderName: draft.senderName,
            senderRole: draft.senderRole,
            replyToEmail: draft.replyToEmail,
            websiteUrl: draft.websiteUrl,
            approvedClaims: draft.approvedClaims,
            offeredServices: draft.offeredServices,
            pricingPolicy: draft.pricingPolicy,
            outboundSendingEnabled: draft.outboundSendingEnabled,
            defaultCountry: draft.defaultCountry,
            defaultCity: draft.defaultCity,
            dailyOutreachCap: draft.dailyOutreachCap,
          },
        }),
      { success: 'Settings saved' },
    );
    if (result) {
      setDraft(null);
      refetch();
      refresh();
    }
  };

  const toggleService = (key: string) =>
    update(
      'offeredServices',
      settings.offeredServices.includes(key)
        ? settings.offeredServices.filter((s) => s !== key)
        : [...settings.offeredServices, key],
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Who the agents say they are, what they are allowed to claim, and whether anything may leave the platform."
        actions={
          can('admin') && (
            <button type="button" className="btn-primary" onClick={save} disabled={pending || !draft}>
              {pending ? <Spinner /> : <Save className="h-4 w-4" />}
              Save changes
            </button>
          )
        }
      />

      {!can('admin') && <InfoNote>Settings are admin-only. You are viewing them read-only.</InfoNote>}

      {can('admin') && (status?.demoLeads ?? 0) > 0 && (
        <Card>
          <SectionTitle>Demo data</SectionTitle>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {status?.demoLeads} demo record{status?.demoLeads === 1 ? '' : 's'} are in the database. They exist so
            the pipeline can be learned before real leads arrive; once it has been, they crowd the approvals
            queue with samples that can never be contacted. Removing them deletes those leads and their
            messages, approvals and conversations. Live records are not touched, and this cannot be undone.
          </p>
          <button
            type="button"
            className="btn-secondary mt-4 text-rose-600 dark:text-rose-400"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Remove ${status?.demoLeads} demo record(s) and everything attached to them?`))
                return;
              void run(
                () => api<{ removed: { leads: number; messages: number; approvals: number } }>(
                  '/system/demo-data/clear',
                  { method: 'POST', body: { confirm: true } },
                ),
                { success: 'Demo records removed', onSuccess: refresh },
              );
            }}
          >
            {pending ? <Spinner /> : <Trash2 className="h-4 w-4" />}
            Remove demo records
          </button>
        </Card>
      )}

      <Card>
        <SectionTitle>Outbound safety</SectionTitle>
        <div className="space-y-4">
          <Toggle
            checked={settings.outboundSendingEnabled}
            onChange={(value) => update('outboundSendingEnabled', value)}
            disabled={!can('admin')}
            label="Allow approved messages to be dispatched"
            description="Off by default. With this off, approved messages are queued and never delivered. Each message still needs its own human approval and a connected channel before it can leave."
          />
          <Toggle
            checked
            onChange={() => undefined}
            disabled
            label="First contact always requires human approval"
            description="This cannot be turned off in this version. Autonomous mass messaging is deliberately not implemented."
          />
          <Field label="Daily outreach cap" hint="Upper bound on messages per day once sending is enabled.">
            <input
              className="input max-w-[200px]"
              type="number"
              min={1}
              max={1000}
              value={settings.dailyOutreachCap}
              onChange={(e) => update('dailyOutreachCap', Number(e.target.value))}
              disabled={!can('admin')}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle hint="Used by the Outreach and Conversation agents">Identity</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name">
            <input
              className="input"
              value={settings.companyName}
              onChange={(e) => update('companyName', e.target.value)}
              disabled={!can('admin')}
            />
          </Field>
          <Field label="Sender name" hint="The human the AI assistant works for.">
            <input
              className="input"
              value={settings.senderName}
              onChange={(e) => update('senderName', e.target.value)}
              disabled={!can('admin')}
            />
          </Field>
          <Field label="Sender role">
            <input
              className="input"
              value={settings.senderRole}
              onChange={(e) => update('senderRole', e.target.value)}
              disabled={!can('admin')}
            />
          </Field>
          <Field label="Reply-to email">
            <input
              className="input"
              type="email"
              value={settings.replyToEmail}
              onChange={(e) => update('replyToEmail', e.target.value)}
              disabled={!can('admin')}
            />
          </Field>
          <Field label="Default country">
            <input
              className="input"
              value={settings.defaultCountry}
              onChange={(e) => update('defaultCountry', e.target.value)}
              disabled={!can('admin')}
            />
          </Field>
          <Field label="Default city">
            <input
              className="input"
              value={settings.defaultCity}
              onChange={(e) => update('defaultCity', e.target.value)}
              disabled={!can('admin')}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <SectionTitle hint="Agents may not claim anything outside this list">What the agents may say</SectionTitle>
        <Field
          label="Approved claims"
          hint="One per line. The Outreach and Conversation agents are limited to these statements."
        >
          <textarea
            className="input min-h-[130px]"
            value={settings.approvedClaims.join('\n')}
            onChange={(e) => update('approvedClaims', e.target.value.split('\n').filter((line) => line.trim()))}
            disabled={!can('admin')}
          />
        </Field>
        <div className="mt-4">
          <Field label="Pricing policy" hint="How agents must respond when a prospect asks about price.">
            <textarea
              className="input min-h-[80px]"
              value={settings.pricingPolicy}
              onChange={(e) => update('pricingPolicy', e.target.value)}
              disabled={!can('admin')}
            />
          </Field>
        </div>
        <div className="mt-4">
          <InfoNote tone="warning">
            <ShieldAlert className="inline h-4 w-4" /> Regardless of what is written here, the agents are hard-coded
            never to quote a price, promise a guarantee, state an unverifiable statistic, or claim to be human. Those
            checks run after generation and replace any draft that breaks them.
          </InfoNote>
        </div>
      </Card>

      <Card>
        <SectionTitle hint="Empty means the whole catalogue is available">Services you actually sell</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(catalog?.services ?? []).map((service) => (
            <label
              key={service.key}
              className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 p-2.5 dark:border-white/10"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={settings.offeredServices.includes(service.key)}
                onChange={() => toggleService(service.key)}
                disabled={!can('admin')}
              />
              <span>
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{service.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{service.summary}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      {can('admin') && <TeamCard />}
    </div>
  );
}

function TeamCard() {
  const { data, refetch } = useQuery<{ items: User[] }>('/auth/users');
  const [showCreate, setShowCreate] = useState(false);

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-3 p-5 pb-2">
        <SectionTitle hint="Role-based access control">Team</SectionTitle>
        <button type="button" className="btn-secondary" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          Add user
        </button>
      </div>

      <div className="px-5 pb-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
            <div key={role} className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.04]">
              <p className="text-sm font-medium capitalize text-slate-800 dark:text-slate-200">{role}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
            </div>
          ))}
        </div>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Status</Th>
            <Th>Created</Th>
          </tr>
        </thead>
        <tbody>
          {(data?.items ?? []).map((user) => (
            <tr key={user.id} className="row-hover">
              <Td className="font-medium text-slate-800 dark:text-slate-100">
                <span className="inline-flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-slate-400" />
                  {user.name}
                </span>
              </Td>
              <Td className="text-slate-600 dark:text-slate-300">{user.email}</Td>
              <Td>
                <Badge tone={user.role === 'admin' ? 'brand' : 'neutral'}>{user.role}</Badge>
              </Td>
              <Td>
                <Badge tone={user.active ? 'success' : 'neutral'}>{user.active ? 'active' : 'disabled'}</Badge>
              </Td>
              <Td className="text-xs text-slate-500">{dateOnly(user.createdAt)}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <CreateUserModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={refetch} />
    </Card>
  );
}

function CreateUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { run, pending } = useAction();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'analyst' });

  const submit = async () => {
    const result = await run(() => api('/auth/users', { method: 'POST', body: form }), {
      success: 'User created',
    });
    if (result) {
      onCreated();
      onClose();
      setForm({ name: '', email: '', password: '', role: 'analyst' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a team member"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={pending || !form.name || !form.email || form.password.length < 8}
          >
            {pending && <Spinner />}
            Create user
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Password" hint="Minimum 8 characters. They can change it later.">
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <Field label="Role">
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.keys(ROLE_DESCRIPTIONS).map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </Field>
        <InfoNote>{ROLE_DESCRIPTIONS[form.role]}</InfoNote>
      </div>
    </Modal>
  );
}
