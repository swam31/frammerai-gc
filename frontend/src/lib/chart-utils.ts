export const CHART_COLORS = [
  '#dc2626', '#f87171', '#991b1b', '#f97316',
  '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#a855f7', '#64748b',
];

export function formatNumber(v: number | string | null | undefined): string {
  const n = Number(v) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(1);
}

export function formatDuration(v: number | string | null | undefined): string {
  const hours = Number(v) || 0;
  if (hours >= 24) return `${(hours / 24).toFixed(1)} days`;
  if (hours >= 1) return `${hours.toFixed(1)} hrs`;
  return `${(hours * 60).toFixed(0)} min`;
}

export function formatPercent(v: number | string | null | undefined): string {
  const pct = Number(v) || 0;
  return `${pct.toFixed(1)}%`;
}

export function shortDate(dateStr: string): string {
  if (!dateStr) return '';
  const weeklyMatch = /^(\d{4})-W(\d{2})$/.exec(dateStr);
  if (weeklyMatch) {
    const [, year, week] = weeklyMatch;
    return `W${week} ${year}`;
  }

  const monthlyMatch = /^(\d{4})-(\d{2})$/.exec(dateStr);
  if (monthlyMatch) {
    const [, year, month] = monthlyMatch;
    const d = new Date(`${year}-${month}-01`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    return dateStr;
  }

  const quarterlyMatch = /^(\d{4})-Q([1-4])$/.exec(dateStr);
  if (quarterlyMatch) {
    const [, year, quarter] = quarterlyMatch;
    return `Q${quarter} ${year}`;
  }

  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    return dateStr;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function customTooltipStyle(): React.CSSProperties {
  return {
    backgroundColor: 'var(--bg-surface-solid)',
    border: '1px solid var(--border-default)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-lg)',
    padding: '12px 16px',
    fontSize: '0.8rem',
    color: 'var(--text-primary)',
    fontFamily: 'IBM Plex Sans, sans-serif',
  };
}
