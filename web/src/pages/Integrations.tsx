import { useState } from 'react';
import { KeyRound, Lock, Plug, ShieldCheck, Wifi } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useAuth, useQuery, useSystemStatus } from '../lib/hooks';
import { relativeTime, titleCase } from '../lib/format';
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
  Toggle,
} from '../components/ui';
import type { Integration } from '../lib/types';

interface IntegrationsResponse {
  items: Integration[];
}

/**
 * Integration credentials are write-only: the API returns masked hints and
 * connection state, never a stored secret. Leaving a field blank keeps the
 * existing value, so the UI never has to echo a key back.
 */
export function IntegrationsPage() {
  const { can } = useAuth();
  const { refresh } = useSystemStatus();
  const { data, loading, error, refetch } = useQuery<IntegrationsResponse>('/system/integrations');
  const [editing, setEditing] = useState<Integration | null>(null);

  if (loading) return <LoadingBlock label="Loading integrations" />;
  if (error) return <ErrorBlock message={error} onRetry={refetch} />;
  if (!data) return null;

  const grouped = data.items.reduce<Record<string, Integration[]>>((acc, integration) => {
    (acc[integration.category] ??= []).push(integration);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect the platform to real data and real channels. Everything works in demo mode until you do."
      />

      <InfoNote>
        <ShieldCheck className="inline h-4 w-4" /> Secrets are encrypted at rest with AES-256-GCM and are never sent
        to the browser or included in any export. Keys supplied through environment variables are used automatically
        and shown as “from environment”.
      </InfoNote>

      {Object.entries(grouped).map(([category, integrations]) => (
        <div key={category}>
          <SectionTitle>{titleCase(category)}</SectionTitle>
          <div className="grid gap-5 lg:grid-cols-2">
            {integrations.map((integration) => (
              <Card key={integration.key} className="flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300">
                        <Plug className="h-4 w-4" />
                      </span>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{integration.name}</h3>
                      <Badge tone={integration.enabled ? 'success' : integration.configured ? 'warning' : 'neutral'}>
                        {integration.enabled ? 'connected' : integration.configured ? 'configured, off' : 'not connected'}
                      </Badge>
                      {integration.fromEnv && <Badge tone="info">from environment</Badge>}
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{integration.description}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {integration.capabilities.map((capability) => (
                    <Badge key={capability} tone="neutral">
                      {capability}
                    </Badge>
                  ))}
                </div>

                {Object.keys(integration.credentialHints).length > 0 && (
                  <dl className="mt-3 space-y-1 text-sm">
                    {Object.entries(integration.credentialHints).map(([field, hint]) => (
                      <div key={field} className="flex items-center gap-2">
                        <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                          <Lock className="h-3 w-3" />
                          {field}
                        </dt>
                        <dd className="font-mono text-xs text-slate-600 dark:text-slate-300">{hint}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {integration.lastError && (
                  <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                    Last error: {integration.lastError}
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-white/5">
                  <span className="text-xs text-slate-400">
                    {integration.lastCheckedAt ? `Last checked ${relativeTime(integration.lastCheckedAt)}` : 'Never used'}
                  </span>
                  {can('admin') && (
                    <button type="button" className="btn-secondary" onClick={() => setEditing(integration)}>
                      <KeyRound className="h-4 w-4" />
                      {integration.configured ? 'Manage' : 'Connect'}
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <ConnectModal
        integration={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refetch();
          refresh();
        }}
      />
    </div>
  );
}

function ConnectModal({
  integration,
  onClose,
  onSaved,
}: {
  integration: Integration | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { run, pending } = useAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  if (integration && loaded !== integration.key) {
    setLoaded(integration.key);
    setValues({});
    setEnabled(integration.enabled);
    setTestResult(null);
  }

  if (!integration) return <Modal open={false} onClose={onClose} title="" children={null} />;

  /** Authenticates against the provider without sending anything. */
  const testConnection = async () => {
    if (!integration) return;
    const result = await run<{ ok: boolean; detail: string }>(
      () => api(`/system/integrations/${integration.key}/test`, { method: 'POST', body: {} }),
      {},
    );
    if (result) setTestResult(result);
  };

  const save = async () => {
    const credentials = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value.trim() !== ''),
    );
    const result = await run(
      () =>
        api(`/system/integrations/${integration.key}`, {
          method: 'PATCH',
          body: { credentials, enabled },
        }),
      { success: `${integration.name} updated` },
    );
    if (result) onSaved();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Connect ${integration.name}`}
      description={integration.description}
      footer={
        <>
          {integration.key === 'gmail' && (
            <button type="button" className="btn-secondary" onClick={testConnection} disabled={pending}>
              {pending ? <Spinner /> : <Wifi className="h-4 w-4" />}
              Test connection
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={pending}>
            {pending && <Spinner />}
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {integration.fromEnv && (
          <InfoNote>
            A credential for this integration is already supplied by an environment variable. Anything you enter here
            takes precedence over it.
          </InfoNote>
        )}

        {integration.fields.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            hint={
              integration.credentialHints[field.key]
                ? `Currently ${integration.credentialHints[field.key]} — leave blank to keep it.`
                : field.secret
                  ? 'Stored encrypted. Never returned by the API.'
                  : undefined
            }
          >
            <input
              className="input font-mono text-sm"
              type={field.secret ? 'password' : 'text'}
              placeholder={field.placeholder ?? (field.secret ? '••••••••' : '')}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              autoComplete="off"
            />
          </Field>
        ))}

        <div className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
          <Toggle
            checked={enabled}
            onChange={setEnabled}
            label="Enable this integration"
            description="Agents will only use it once it is both configured and enabled."
          />
        </div>

        {testResult && (
          <InfoNote tone={testResult.ok ? undefined : 'warning'}>
            {testResult.ok ? '✅ ' : '⚠️ '}
            {testResult.detail}
          </InfoNote>
        )}

        {integration.key === 'gmail' ? (
          <InfoNote>
            Save the address and App Password first, then use <strong>Test connection</strong> — it
            authenticates with Gmail and disconnects without emailing anyone.
          </InfoNote>
        ) : null}

        {integration.key === 'gmail' || integration.key === 'whatsapp_business' ? (
          <InfoNote tone="warning">
            Connecting a channel does not start sending. Outbound delivery also requires the sending switch in
            Settings and an approved message.
          </InfoNote>
        ) : null}
      </div>
    </Modal>
  );
}
