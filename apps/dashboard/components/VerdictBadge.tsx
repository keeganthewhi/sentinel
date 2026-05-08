interface VerdictBadgeProps {
  readonly verdict: 'PASS' | 'FAIL';
}

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
  const cls =
    verdict === 'PASS'
      ? 'bg-[var(--color-pass)]/15 text-[var(--color-pass)] border-[var(--color-pass)]/40'
      : 'bg-[var(--color-fail)]/15 text-[var(--color-fail)] border-[var(--color-fail)]/40';
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded border px-3 py-1 text-sm font-semibold ${cls}`}
    >
      {verdict}
    </span>
  );
}
