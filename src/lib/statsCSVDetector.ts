import type { SalesKnowledgeInsert } from '@/hooks/useAdminSalesKnowledge';

/** Pattern matches for campaign name columns */
const NAME_PATTERNS = [
  /^campaign/i, /^sequence/i, /^name$/i, /^campaign[\s_-]?name/i,
  /^sequence[\s_-]?name/i, /^subject/i,
];

export interface StatsCSVConfig {
  nameCol: string;
  numericCols: string[];
  textCols: string[];
}

/**
 * Analyse CSV headers and classify columns. Always returns a config.
 * Finds the best campaign-name column (pattern match or first text col),
 * then classifies everything else as numeric or text.
 */
export function detectStatsCSV(
  headers: string[],
  data: Record<string, string>[]
): StatsCSVConfig {
  const sample = data.slice(0, 5);

  // Find campaign name column via pattern match
  let nameCol: string | null = null;
  for (const h of headers) {
    if (NAME_PATTERNS.some(p => p.test(h.trim()))) {
      nameCol = h;
      break;
    }
  }

  // Classify remaining columns
  const numericCols: string[] = [];
  const textCols: string[] = [];

  for (const h of headers) {
    if (h === nameCol) continue;
    const values = sample.map(r => (r[h] ?? '').trim()).filter(Boolean);
    if (values.length === 0) { textCols.push(h); continue; }
    const numericCount = values.filter(v => !isNaN(parseFloat(v.replace(/[,%$]/g, '')))).length;
    if (numericCount / values.length >= 0.6) {
      numericCols.push(h);
    } else {
      textCols.push(h);
    }
  }

  // If no pattern-matched name col, use the first text column
  if (!nameCol) {
    nameCol = textCols.shift() ?? headers[0];
  }

  return { nameCol, numericCols, textCols };
}

/** Convert a header into a snake_case metric key */
function toMetricKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Parse a numeric string, stripping %, $, commas */
function parseNum(val: string): number {
  return parseFloat(val.replace(/[,%$\s]/g, '')) || 0;
}

/**
 * Transform all rows of a stats CSV into SalesKnowledgeInsert entries.
 */
export function transformStatsRows(
  data: Record<string, string>[],
  config: StatsCSVConfig
): { entry: SalesKnowledgeInsert; valid: boolean; error?: string }[] {
  const now = new Date();
  const monthLabel = now.toLocaleString('default', { month: 'short', year: 'numeric' });

  return data.map(row => {
    const name = (row[config.nameCol] ?? '').trim();
    if (!name) {
      return { entry: {} as any, valid: false, error: 'Missing campaign name' };
    }

    // Extract metrics
    const metrics: Record<string, number> = {};
    for (const col of config.numericCols) {
      const raw = (row[col] ?? '').trim();
      if (raw) metrics[toMetricKey(col)] = parseNum(raw);
    }

    // Calculate derived rates if possible
    const delivered = metrics.delivered ?? metrics.delivered_count ?? metrics.sent ?? metrics.sent_count ?? 0;
    const replies = metrics.replied ?? metrics.replied_count ?? metrics.replies ?? 0;
    if (delivered > 0 && replies > 0 && !metrics.reply_rate) {
      metrics.reply_rate = Math.round((replies / delivered) * 1000) / 10;
    }

    // Build content summary
    const contentParts = config.numericCols
      .map(col => {
        const raw = (row[col] ?? '').trim();
        return raw ? `${col}: ${raw}` : null;
      })
      .filter(Boolean);
    const content = contentParts.join(' | ') || 'No metrics available';

    // Extract tags from text columns
    const tags = config.textCols
      .map(col => (row[col] ?? '').trim())
      .filter(Boolean)
      .slice(0, 5);

    const title = `${name} - Performance Baseline (${monthLabel})`;

    return {
      valid: true,
      entry: {
        category: 'campaign_result' as const,
        title,
        content,
        metrics: Object.keys(metrics).length ? metrics : undefined,
        tags: tags.length ? tags : undefined,
        source_campaign: name,
      },
    };
  });
}
