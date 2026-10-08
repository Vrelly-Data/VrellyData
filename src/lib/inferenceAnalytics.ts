// Admin → Inference: shared vocabulary, formatting and small mappers.
//
// The aggregation itself runs in Postgres (public.admin_inference_insights,
// migration 20261008012000): the browser no longer downloads every reply. This
// module turns that function's grouped counts into the shapes the UI renders.
// Dimension values are the display strings the SQL returns ('(unknown)',
// 'Step 2', '09:00', 'Mon', …); the UI sends them back unchanged as a segment
// filter.

export type Origin = 'live' | 'backfill';
export type SourceFilter = 'all' | Origin;

// A row is backfill when it came from the Reply.io history import, or when it is one of the
// older mirrored rows (agent_leads / draft_audit / classify_reply replays) stamped
// metadata.backfill = true. Everything else was captured live.
export const BACKFILL_SOURCE = 'reply2_backfill';

export const DIMENSIONS = [
  'industry',
  'companySize',
  'seniority',
  'jobTitle',
  'state',
  'channel',
  'step',
  'sendHour',
  'sendDow',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  industry: 'Industry',
  companySize: 'Company size',
  seniority: 'Seniority',
  jobTitle: 'Job title',
  state: 'State',
  channel: 'Channel',
  step: 'Sequence step',
  sendHour: 'Send hour (ET)',
  sendDow: 'Send weekday (ET)',
};

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const UNKNOWN = '(unknown)';
export const MIN_SAMPLE = 30;

export type SegmentFilter = Partial<Record<Dimension, string>>;

// ── Stats from the SQL function ────────────────────────────────────────────

// As returned by admin_inference_insights for any group of replies.
export type RpcStats = {
  replies: number;
  interested: number;
  not_interested: number;
  live: number;
  median_hours: number | null;
  hours_sample: number;
};

export type Stats = {
  replies: number;
  interested: number;
  notInterested: number;
  interestedRate: number; // interested share of replies (no non-responder sends, so not a reply rate)
  medianHoursToReply: number | null;
  hoursSample: number; // replies that carry hours-to-reply
  live: number;
  backfill: number;
};

export function toStats(s: Partial<RpcStats> | null | undefined): Stats {
  const replies = Number(s?.replies ?? 0);
  const interested = Number(s?.interested ?? 0);
  const live = Number(s?.live ?? 0);
  const median = s?.median_hours;
  return {
    replies,
    interested,
    notInterested: Number(s?.not_interested ?? 0),
    interestedRate: replies ? interested / replies : 0,
    medianHoursToReply: median === null || median === undefined ? null : Number(median),
    hoursSample: Number(s?.hours_sample ?? 0),
    live,
    backfill: replies - live,
  };
}

export type SegmentRow = Stats & { key: string; values: SegmentFilter; lift: number | null };

export function toSegmentRow(r: RpcStats & { values: SegmentFilter }, baselineRate: number): SegmentRow {
  const st = toStats(r);
  return { ...st, key: suggestionKey(r.values), values: r.values, lift: baselineRate > 0 ? st.interestedRate / baselineRate : null };
}

// Stable key for a segment, independent of dimension order.
export function suggestionKey(values: SegmentFilter): string {
  return (
    'seg:' +
    (Object.entries(values) as Array<[string, string]>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => `${d}=${v}`)
      .join('|')
  );
}

export type Suggestion = SegmentRow & { suggestionKey: string };

export function describeSegment(values: SegmentFilter): string {
  const parts = (Object.entries(values) as Array<[Dimension, string]>).map(
    ([d, v]) => `${DIMENSION_LABELS[d]}: ${v}`,
  );
  return parts.length ? parts.join(' · ') : 'All replies';
}

// ── Copy leaderboard + heatmap shapes ──────────────────────────────────────

export type CopyRow = Stats & { key: string; label: string; interestedShare: number };

export type RpcCopy = {
  by_interested: Array<RpcStats & { key: string; label: string | null }>;
  by_share: Array<RpcStats & { key: string; label: string | null }>;
  without_copy: number;
  rows: number;
  live: number;
};

export function toCopyRows(list: RpcCopy['by_interested'] | undefined): CopyRow[] {
  return (list ?? []).map((c) => {
    const st = toStats(c);
    return { ...st, key: c.key, label: c.label ?? `Variant ${String(c.key).slice(0, 10)}`, interestedShare: st.interestedRate };
  });
}

export type RpcHeatmap = {
  cells: Array<{ dow: number; hour: number; n: number }>;
  counted: number;
  interested: number;
  interested_live: number;
};

// Interested replies by reply weekday (rows, ISO 1–7) × hour (0–23), Eastern Time.
export function heatmapGrid(h: RpcHeatmap | undefined): { cells: number[][]; max: number } {
  const cells = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  let max = 0;
  for (const c of h?.cells ?? []) {
    if (c.dow < 1 || c.dow > 7 || c.hour < 0 || c.hour > 23) continue;
    cells[c.dow - 1][c.hour] = c.n;
    if (c.n > max) max = c.n;
  }
  return { cells, max };
}

// ── Enrichment bias ────────────────────────────────────────────────────────
// A dimension is biased when its value is known far more often for interested
// replies than for the rest (e.g. backfill firmographics were looked up mostly
// for interested leads). Segment rates on such a dimension measure the
// enrichment, not the segment.

export type DimensionBias = { knownInterested: number; knownOther: number; biased: boolean };
const BIAS_GAP = 0.2;

export type RpcBias = {
  interested: number;
  other: number;
  // per dimension: [known among interested, known among the rest]
  known: Partial<Record<Dimension, [number, number]>>;
};

export function biasFromCounts(b: RpcBias | undefined): Record<Dimension, DimensionBias> {
  const out = {} as Record<Dimension, DimensionBias>;
  const nI = Number(b?.interested ?? 0);
  const nO = Number(b?.other ?? 0);
  for (const d of DIMENSIONS) {
    const [kI, kO] = b?.known?.[d] ?? [0, 0];
    const knownInterested = nI ? Number(kI) / nI : 0;
    const knownOther = nO ? Number(kO) / nO : 0;
    out[d] = {
      knownInterested,
      knownOther,
      biased: nI >= MIN_SAMPLE && nO >= MIN_SAMPLE && knownInterested - knownOther >= BIAS_GAP,
    };
  }
  return out;
}

export function biasedDims(values: SegmentFilter, bias: Record<Dimension, DimensionBias>): Dimension[] {
  return (Object.keys(values) as Dimension[]).filter((d) => bias[d]?.biased);
}

export function describeBias(d: Dimension, b: DimensionBias): string {
  return `${DIMENSION_LABELS[d]} is known for ${pct(b.knownInterested, 0)} of interested replies but only ${pct(b.knownOther, 0)} of the rest`;
}

// ── Formatting ─────────────────────────────────────────────────────────────

export function cleanSubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const s = subject.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
  return s || null;
}

export function pct(rate: number | null | undefined, digits = 1): string {
  return rate === null || rate === undefined || !Number.isFinite(rate) ? '—' : `${(rate * 100).toFixed(digits)}%`;
}

export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export function fmtLift(lift: number | null | undefined): string {
  return lift === null || lift === undefined ? '—' : `${lift.toFixed(1)}× baseline`;
}
