import type { SalesKnowledgeInsert } from '@/hooks/useAdminSalesKnowledge';

/** Pattern matches for campaign/sequence name columns */
const NAME_PATTERNS = [
  /^campaign/i, /^sequence/i, /^name$/i, /^campaign[\s_-]?name/i,
  /^sequence[\s_-]?name/i,
];

/** Pattern matches for action type columns */
const ACTION_PATTERNS = [
  /^action[\s_-]?type/i, /^action$/i, /^activity[\s_-]?type/i, /^type$/i,
];

/** Pattern matches for contact identity columns (used for unique contact counting) */
const CONTACT_ID_PATTERNS = [
  /^contact[\s_-]?id/i, /^contact[\s_-]?email/i, /^email/i, /^id$/i,
];

export interface StatsCSVConfig {
  nameCol: string;
  actionCol: string | null;
  contactIdCol: string | null;
  numericCols: string[];
  textCols: string[];
}

/** Find the first header matching any of the given patterns */
function findCol(headers: string[], patterns: RegExp[]): string | null {
  for (const h of headers) {
    if (patterns.some(p => p.test(h.trim()))) return h;
  }
  return null;
}

/**
 * Analyse CSV headers and classify columns.
 * Identifies the campaign/sequence name column, an optional action-type column,
 * a contact-identity column, and classifies everything else as numeric or text.
 */
export function detectStatsCSV(
  headers: string[],
  data: Record<string, string>[]
): StatsCSVConfig {
  const sample = data.slice(0, 5);

  const nameCol = findCol(headers, NAME_PATTERNS);
  const actionCol = findCol(headers, ACTION_PATTERNS);
  const contactIdCol = findCol(headers, CONTACT_ID_PATTERNS);

  // Classify remaining columns
  const reserved = new Set([nameCol, actionCol, contactIdCol].filter(Boolean));
  const numericCols: string[] = [];
  const textCols: string[] = [];

  for (const h of headers) {
    if (reserved.has(h)) continue;
    const values = sample.map(r => (r[h] ?? '').trim()).filter(Boolean);
    if (values.length === 0) { textCols.push(h); continue; }
    const numericCount = values.filter(v => !isNaN(parseFloat(v.replace(/[,%$]/g, '')))).length;
    if (numericCount / values.length >= 0.6) {
      numericCols.push(h);
    } else {
      textCols.push(h);
    }
  }

  // Fallback: if no name col found, use first text column
  const resolvedNameCol = nameCol ?? textCols.shift() ?? headers[0];

  return { nameCol: resolvedNameCol, actionCol, contactIdCol, numericCols, textCols };
}

/** Convert a string into a snake_case metric key */
function toMetricKey(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Transform CSV rows into aggregated SalesKnowledgeInsert entries.
 *
 * If an action-type column is detected (activity-log CSV), rows are grouped
 * by the name column and action types are tallied into metrics.
 *
 * If no action-type column exists (pre-aggregated stats CSV), each row
 * becomes its own entry with numeric columns as metrics (legacy behaviour).
 */
export function transformStatsRows(
  data: Record<string, string>[],
  config: StatsCSVConfig
): { entry: SalesKnowledgeInsert; valid: boolean; error?: string }[] {
  const now = new Date();
  const monthLabel = now.toLocaleString('default', { month: 'short', year: 'numeric' });

  // --- Activity-log path: group by sequence, tally action types ---
  if (config.actionCol) {
    const groups: Record<string, Record<string, string>[]> = {};
    for (const row of data) {
      const name = (row[config.nameCol] ?? '').trim();
      if (!name) continue;
      if (!groups[name]) groups[name] = [];
      groups[name].push(row);
    }

    if (Object.keys(groups).length === 0) {
      return [{ entry: {} as any, valid: false, error: 'No sequence/campaign names found' }];
    }

    return Object.entries(groups).map(([name, rows]) => {
      // Count each action type
      const actionCounts: Record<string, number> = {};
      for (const row of rows) {
        const action = (row[config.actionCol!] ?? '').trim();
        if (!action) continue;
        const key = toMetricKey(action);
        actionCounts[key] = (actionCounts[key] || 0) + 1;
      }

      // Count unique contacts
      if (config.contactIdCol) {
        const uniqueContacts = new Set(
          rows.map(r => (r[config.contactIdCol!] ?? '').trim().toLowerCase()).filter(Boolean)
        );
        actionCounts.total_contacts = uniqueContacts.size;
      }

      // Derive reply rate if possible
      const sent = actionCounts.message_sent ?? actionCounts.email_sent ?? actionCounts.sent ?? 0;
      const replies = actionCounts.reply ?? actionCounts.replied ?? 0;
      if (sent > 0 && replies > 0) {
        actionCounts.reply_rate = Math.round((replies / sent) * 1000) / 10;
      }

      // Build content summary
      const contentParts = Object.entries(actionCounts)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}${k.includes('rate') ? '%' : ''}`);
      const content = contentParts.join(' | ') || 'No metrics available';

      const title = `${name} - Performance Baseline (${monthLabel})`;

      return {
        valid: true,
        entry: {
          category: 'campaign_result' as const,
          title,
          content,
          metrics: actionCounts,
          source_campaign: name,
        },
      };
    });
  }

  // --- Pre-aggregated stats path (legacy): one entry per row ---
  return data.map(row => {
    const name = (row[config.nameCol] ?? '').trim();
    if (!name) {
      return { entry: {} as any, valid: false, error: 'Missing campaign name' };
    }

    const metrics: Record<string, number> = {};
    for (const col of config.numericCols) {
      const raw = (row[col] ?? '').trim();
      if (raw) metrics[toMetricKey(col)] = parseFloat(raw.replace(/[,%$\s]/g, '')) || 0;
    }

    const delivered = metrics.delivered ?? metrics.sent ?? 0;
    const replies = metrics.replied ?? metrics.replies ?? 0;
    if (delivered > 0 && replies > 0 && !metrics.reply_rate) {
      metrics.reply_rate = Math.round((replies / delivered) * 1000) / 10;
    }

    const contentParts = config.numericCols
      .map(col => {
        const raw = (row[col] ?? '').trim();
        return raw ? `${col}: ${raw}` : null;
      })
      .filter(Boolean);
    const content = contentParts.join(' | ') || 'No metrics available';

    const title = `${name} - Performance Baseline (${monthLabel})`;

    return {
      valid: true,
      entry: {
        category: 'campaign_result' as const,
        title,
        content,
        metrics: Object.keys(metrics).length ? metrics : undefined,
        source_campaign: name,
      },
    };
  });
}
