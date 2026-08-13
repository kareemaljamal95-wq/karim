export const currency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
};

export const compactCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  if (Math.abs(value) < 10000) return currency(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
};

export const number = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US').format(value);

export const percent = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${Math.round(value)}%`;

export const dateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const dateOnly = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return dateOnly(iso);
}

export const titleCase = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const initials = (value: string): string =>
  value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

export const cx = (...classes: (string | false | null | undefined)[]): string =>
  classes.filter(Boolean).join(' ');
