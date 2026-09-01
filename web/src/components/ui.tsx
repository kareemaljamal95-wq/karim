import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { cx } from '../lib/format';
import { useToast } from '../lib/hooks';
import type { LeadStatus } from '../lib/types';

/* -------------------------------------------------------------------------- */
/* Layout primitives                                                           */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={cx('card', padded && 'p-5', className)}>{children}</div>;
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {children}
      </h2>
      {hint && <span className="text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-4 w-4 animate-spin', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500 dark:text-slate-400">
      <Spinner />
      {label}…
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-rose-200 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/5">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
        <div>
          <p className="text-sm font-medium text-rose-900 dark:text-rose-200">{message}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-2 text-sm font-medium text-rose-700 underline dark:text-rose-300">
              Try again
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-white/10">
      {icon && <div className="mb-3 text-slate-400 dark:text-slate-500">{icon}</div>}
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ToastViewport() {
  const { toasts, dismiss } = useToast();
  if (!toasts.length) return null;

  const tone = {
    success: {
      icon: <CheckCircle2 className="h-4 w-4" />,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200',
    },
    error: {
      icon: <XCircle className="h-4 w-4" />,
      className: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200',
    },
    info: {
      icon: <Info className="h-4 w-4" />,
      className: 'border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-[#161c2c] dark:text-slate-100',
    },
  };

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cx(
            'pointer-events-auto flex animate-slide-in items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg',
            tone[toast.tone].className,
          )}
        >
          <span className="mt-0.5 shrink-0">{tone[toast.tone].icon}</span>
          <p className="flex-1">{toast.message}</p>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            <X className="h-4 w-4 opacity-60 transition hover:opacity-100" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges & indicators                                                         */
/* -------------------------------------------------------------------------- */

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 dark:bg-white/[0.07] dark:text-slate-300',
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  info: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  purple: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<LeadStatus, BadgeTone> = {
  NEW: 'neutral',
  RESEARCHING: 'info',
  QUALIFIED: 'brand',
  APPROVAL_REQUIRED: 'warning',
  CONTACTED: 'info',
  REPLIED: 'purple',
  INTERESTED: 'success',
  NEGOTIATING: 'purple',
  WON: 'success',
  LOST: 'danger',
  NOT_A_FIT: 'neutral',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status as LeadStatus] ?? 'neutral';
  return <Badge tone={tone}>{status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

export function GradeBadge({ grade }: { grade: 'A' | 'B' | 'C' | null }) {
  if (!grade) return <Badge tone="neutral">unscored</Badge>;
  const tone: BadgeTone = grade === 'A' ? 'success' : grade === 'B' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} className="font-semibold">
      {grade}
    </Badge>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="warning" className="uppercase tracking-wide">
      <AlertTriangle className="h-3 w-3" />
      demo
    </Badge>
  );
}

/** Compact 0-100 score with a colour that tracks the value. */
export function ScoreBar({ value, label }: { value: number | null; label?: string }) {
  const score = value ?? 0;
  const tone =
    score >= 75 ? 'bg-emerald-500' : score >= 55 ? 'bg-amber-500' : score > 0 ? 'bg-slate-400' : 'bg-slate-300';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div className={cx('h-full rounded-full transition-all', tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="w-8 text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">
        {value === null ? '—' : score}
      </span>
      {label && <span className="text-xs text-slate-400">{label}</span>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Overlays                                                                    */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-black/60"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl animate-fade-in sm:rounded-2xl dark:border-white/10 dark:bg-[#111726]',
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost -mr-2 px-2" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-white/10">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">{children}</table>
      </div>
    </div>
  );
}

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cx('table-head whitespace-nowrap px-4 py-3', className)}>{children}</th>
);

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('border-t border-slate-100 px-4 py-3 align-middle dark:border-white/5', className)}>
    {children}
  </td>
);

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cx(
        'flex items-start gap-3',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cx(
          'mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-white/15',
        )}
      >
        <span
          className={cx(
            'block h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
      <span>
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{description}</span>
        )}
      </span>
    </label>
  );
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return (
    <div
      className={cx(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm',
        tone === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200'
          : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300',
      )}
    >
      {tone === 'warning' ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="flex-1">{children}</div>
    </div>
  );
}
