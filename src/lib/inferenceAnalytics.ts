// Pure aggregation for Admin → Inference. No I/O: everything here takes rows and returns
// numbers, so it can be tested without a database.

export type Origin = 'live' | 'backfill';
export type SourceFilter = 'all' | Origin;

// A row is backfill when it came from the Reply.io history import, or when it is one of the
// older mirrored rows (agent_leads / draft_audit / classify_reply replays) stamped
// metadata.backfill = true. Everything else was captured live.
export const BACKFILL_SOURCE = 'reply2_backfill';

export function originOf(source: string | null | undefined, backfillFlag: unknown): Origin {
  if (source === BACKFILL_SOURCE) return 'backfill';
  if (backfillFlag === true || backfillFlag === 'true') return 'backfill';
  return 'live';
}

// One reply, with the segment context Inference groups by. Values are null when not captured.
export type ReplyRow = {
  id: string;
  origin: Origin;
  channel: string;
  occurredAt: string;
  intent: string | null;
  industry: string | null;
  companySize: string | null;
  seniority: string | null;
  jobTitle: string | null;
  state: string | null;
  step: number | null;
  sendHour: number | null;
  sendDow: number | null; // ISO weekday, 1 = Monday … 7 = Sunday — Eastern Time
  replyHour: number | null; // Eastern Time
  replyDow: number | null; // ISO weekday, Eastern Time
  hoursToReply: number | null;
  copyKey: string | null; // copy_fingerprint, else variant id
  copyLabel: string | null; // subject with Re:/Fwd: removed
};

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
export const OTHER_TITLES = '(other titles)';
export const MIN_SAMPLE = 30;
const TOP_TITLES = 25;

export function formatDimensionValue(dim: Dimension, raw: string | number | null): string {
  if (raw === null || raw === undefined || raw === '') return UNKNOWN;
  if (dim === 'sendDow') return WEEKDAYS[Number(raw) - 1] ?? String(raw);
  if (dim === 'sendHour') return `${String(raw).padStart(2, '0')}:00`;
  if (dim === 'step') return `Step ${raw}`;
  return String(raw);
}

function rawValue(row: ReplyRow, dim: Dimension): string | number | null {
  const v = row[dim];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : null;
  }
  return v;
}

// Job titles are high-cardinality: keep the most common ones, fold the rest.
export function topTitles(rows: ReplyRow[], n = TOP_TITLES): Set<string> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const t = rawValue(r, 'jobTitle');
    if (t !== null) counts.set(String(t), (counts.get(String(t)) ?? 0) + 1);
  }
  return new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t));
}

export function valueFor(row: ReplyRow, dim: Dimension, keepTitles: Set<string>): string {
  const raw = rawValue(row, dim);
  if (dim === 'jobTitle' && raw !== null && !keepTitles.has(String(raw))) return OTHER_TITLES;
  return formatDimensionValue(dim, raw);
}

export type SegmentFilter = Partial<Record<Dimension, string>>;

export function matchesSegment(row: ReplyRow, segment: SegmentFilter, keepTitles: Set<string>): boolean {
  for (const [dim, value] of Object.entries(segment) as Array<[Dimension, string]>) {
    if (valueFor(row, dim, keepTitles) !== value) return false;
  }
  return true;
}

export function filterRows(
  rows: ReplyRow[],
  opts: { source: SourceFilter; from?: Date; to?: Date },
): ReplyRow[] {
  const fromMs = opts.from ? opts.from.getTime() : -Infinity;
  const toMs = opts.to ? opts.to.getTime() : Infinity;
  return rows.filter((r) => {
    if (opts.source !== 'all' && r.origin !== opts.source) return false;
    const t = new Date(r.occurredAt).getTime();
    return t >= fromMs && t <= toMs;
  });
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

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

export function statsFor(rows: ReplyRow[]): Stats {
  let interested = 0;
  let notInterested = 0;
  let live = 0;
  const hours: number[] = [];
  for (const r of rows) {
    if (r.intent === 'interested') interested += 1;
    else if (r.intent === 'not_interested') notInterested += 1;
    if (r.origin === 'live') live += 1;
    if (r.hoursToReply !== null && Number.isFinite(r.hoursToReply)) hours.push(r.hoursToReply);
  }
  return {
    replies: rows.length,
    interested,
    notInterested,
    interestedRate: rows.length ? interested / rows.length : 0,
    medianHoursToReply: median(hours),
    hoursSample: hours.length,
    live,
    backfill: rows.length - live,
  };
}

export type SegmentRow = Stats & { key: string; values: SegmentFilter; lift: number | null };

export function aggregateSegments(
  rows: ReplyRow[],
  dims: Dimension[],
  opts: { includeUnknown: boolean; baselineRate: number; keepTitles: Set<string> },
): SegmentRow[] {
  const groups = new Map<string, { values: SegmentFilter; rows: ReplyRow[] }>();
  for (const r of rows) {
    const values: SegmentFilter = {};
    let skip = false;
    for (const d of dims) {
      const v = valueFor(r, d, opts.keepTitles);
      if (!opts.includeUnknown && v === UNKNOWN) {
        skip = true;
        break;
      }
      values[d] = v;
    }
    if (skip) continue;
    const key = dims.map((d) => values[d]).join(' · ');
    const g = groups.get(key) ?? { values, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    const s = statsFor(g.rows);
    return { ...s, key, values: g.values, lift: opts.baselineRate > 0 ? s.interestedRate / opts.baselineRate : null };
  });
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

const SUGGESTION_DIMS: Dimension[] = ['industry', 'companySize', 'seniority', 'state', 'channel', 'step', 'sendHour', 'sendDow'];

export type Suggestion = SegmentRow & { suggestionKey: string };

// Top segments by lift over the baseline interested share of replies. Single dimensions and
// pairs; a pair is only suggested when it beats both of its single-dimension parents, so it adds
// information. `excludeDims` (e.g. enrichment-biased ones) are left out entirely.
export function suggestDeductions(
  rows: ReplyRow[],
  opts: {
    baselineRate: number;
    keepTitles: Set<string>;
    exclude: Set<string>;
    excludeDims?: Dimension[];
    limit?: number;
    minSample?: number;
  },
): Suggestion[] {
  const minSample = opts.minSample ?? MIN_SAMPLE;
  const dims = SUGGESTION_DIMS.filter((d) => !opts.excludeDims?.includes(d));
  const common = { includeUnknown: false, baselineRate: opts.baselineRate, keepTitles: opts.keepTitles };
  const singleLift = new Map<string, number>();
  const candidates: Suggestion[] = [];

  for (const d of dims) {
    for (const seg of aggregateSegments(rows, [d], common)) {
      if (seg.lift === null) continue;
      singleLift.set(suggestionKey(seg.values), seg.lift);
      if (seg.replies >= minSample && seg.lift > 1) candidates.push({ ...seg, suggestionKey: suggestionKey(seg.values) });
    }
  }
  for (let i = 0; i < dims.length; i++) {
    for (let j = i + 1; j < dims.length; j++) {
      const pair: Dimension[] = [dims[i], dims[j]];
      for (const seg of aggregateSegments(rows, pair, common)) {
        if (seg.lift === null || seg.replies < minSample || seg.lift <= 1) continue;
        const parentLifts = pair.map((d) => singleLift.get(suggestionKey({ [d]: seg.values[d] })) ?? 0);
        if (seg.lift <= Math.max(...parentLifts)) continue;
        candidates.push({ ...seg, suggestionKey: suggestionKey(seg.values) });
      }
    }
  }
  return candidates
    .filter((c) => !opts.exclude.has(c.suggestionKey))
    .sort((a, b) => (b.lift ?? 0) - (a.lift ?? 0) || b.replies - a.replies)
    .slice(0, opts.limit ?? 8);
}

export function describeSegment(values: SegmentFilter): string {
  const parts = (Object.entries(values) as Array<[Dimension, string]>).map(
    ([d, v]) => `${DIMENSION_LABELS[d]}: ${v}`,
  );
  return parts.length ? parts.join(' · ') : 'All replies';
}

export type CopyRow = Stats & { key: string; label: string; interestedShare: number };

export function copyLeaderboard(rows: ReplyRow[]): { rows: CopyRow[]; withoutCopy: number } {
  const groups = new Map<string, { label: string | null; rows: ReplyRow[] }>();
  let withoutCopy = 0;
  for (const r of rows) {
    if (!r.copyKey) {
      withoutCopy += 1;
      continue;
    }
    const g = groups.get(r.copyKey) ?? { label: null, rows: [] };
    if (!g.label && r.copyLabel) g.label = r.copyLabel;
    g.rows.push(r);
    groups.set(r.copyKey, g);
  }
  const out = [...groups.entries()].map(([key, g]) => {
    const s = statsFor(g.rows);
    return { ...s, key, label: g.label ?? `Variant ${key.slice(0, 10)}`, interestedShare: s.interestedRate };
  });
  out.sort((a, b) => b.interested - a.interested || b.interestedShare - a.interestedShare);
  return { rows: out, withoutCopy };
}

export function cleanSubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const s = subject.replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim();
  return s || null;
}

// Interested replies by reply weekday (rows, ISO 1–7) × hour (0–23), Eastern Time.
export function interestedHeatmap(rows: ReplyRow[]): { cells: number[][]; max: number; counted: number; missingTime: number } {
  const cells = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  let max = 0;
  let counted = 0;
  let missingTime = 0;
  for (const r of rows) {
    if (r.intent !== 'interested') continue;
    if (r.replyDow === null || r.replyHour === null || r.replyDow < 1 || r.replyDow > 7 || r.replyHour < 0 || r.replyHour > 23) {
      missingTime += 1;
      continue;
    }
    const v = ++cells[r.replyDow - 1][r.replyHour];
    if (v > max) max = v;
    counted += 1;
  }
  return { cells, max, counted, missingTime };
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

// Enrichment bias: a dimension is biased when its value is known far more often for interested
// replies than for the rest (e.g. backfill firmographics were looked up mostly for interested
// leads). Segment rates on such a dimension measure the enrichment, not the segment.
export type DimensionBias = { knownInterested: number; knownOther: number; biased: boolean };
const BIAS_GAP = 0.2;

export function enrichmentBias(rows: ReplyRow[]): Record<Dimension, DimensionBias> {
  const interested = rows.filter((r) => r.intent === 'interested');
  const other = rows.filter((r) => r.intent !== 'interested');
  const known = (subset: ReplyRow[], d: Dimension) =>
    subset.length ? subset.filter((r) => rawValue(r, d) !== null).length / subset.length : 0;
  const out = {} as Record<Dimension, DimensionBias>;
  for (const d of DIMENSIONS) {
    const knownInterested = known(interested, d);
    const knownOther = known(other, d);
    out[d] = {
      knownInterested,
      knownOther,
      biased: interested.length >= MIN_SAMPLE && other.length >= MIN_SAMPLE && knownInterested - knownOther >= BIAS_GAP,
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
