import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../lib/format';

/**
 * A single headline number. Deliberately not a chart: one value, its label, and
 * at most one supporting line — anything more belongs in a real chart.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  to?: string;
}) {
  const accent = {
    neutral: 'text-slate-500 dark:text-slate-400',
    brand: 'text-brand-600 dark:text-brand-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-rose-600 dark:text-rose-400',
  }[tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        {icon && <span className={cx('shrink-0', accent)}>{icon}</span>}
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-slate-900 dark:text-white">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </>
  );

  const className = cx('card card-hover p-4', to && 'block transition-transform hover:-translate-y-0.5');

  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
