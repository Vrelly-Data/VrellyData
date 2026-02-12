import type { SalesKnowledgeInsert } from '@/hooks/useAdminSalesKnowledge';

/** Pattern matches for campaign name columns */
const NAME_PATTERNS = [
  /^campaign/i, /^sequence/i, /^name$/i, /^campaign[\s_-]?name/i,
  /^sequence[\s_-]?name/i, /^subject/i,
];

interface StatsCSVConfig {
  isStats: true;
  nameCol: string;
  numericCols: string[];
  textCols: string[];
}

/**
 * Detect whether a CSV is a stats/metrics file (lots of numeric columns + a name column).
 * Returns config if detected, null otherwise.
 */
export function detectStatsCSV(
  headers: string[],
  data: Record<string, string>[]
): StatsCSVConfig | null {
  if (headers.length < 3 || data.length === 0) return null;

  // Find campaign name column
  let nameCol: string | null = null;
  for (const h of headers) {
    if (NAME_PATTERNS.some(p => p.test(h.trim()))) {
      nameCol = h;
      break;
    }
  }
  if (!nameCol) return null;

  // Classify columns as numeric or text by sampling first 5 rows
  const sample = data.slice(0, 5);
  const numericCols: string[] = [];
  const textCols: string[] = [];

  for (const h of headers) {
    if (h === nameCol) continue;
    const values = sample.map(r => (r[h] ?? '').trim()).filter(Boolean);
    if (values.length === 0) continue;
    const numericCount = values.filter(v => !isNaN(parseFloat(v.replace(/[,%$]/g, '')))).length;
    if (numericCount / values.length >= 0.6) {
      numericCols.push(h);
    } else {
      textCols.push(h);
    }
  }

  // Stats CSV: >50% of non-name columns are numeric
  const totalNonName = numericCols.length + textCols.length;
  if (totalNonName === 0 || numericCols.length / totalNonName < 0.5) return null;

  return { isStats: true, nameCol, numericCols, textCols };
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
