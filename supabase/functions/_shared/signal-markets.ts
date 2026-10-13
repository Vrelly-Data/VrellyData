// Market assignment — the ONE place that decides which markets a signal is
// relevant to. Every source calls assignMarkets(); nothing else invents markets.
//
// Two inputs:
//   * the company's industry / keywords / description (free text from the
//     source, Vrelly prospects or the inference data), matched against the
//     rules below as whole words, case-insensitive;
//   * the owning team's default market (teams.signals_default_market,
//     admin-editable), for signals that belong to one team.
//
// Per signal type:
//   fda_clearance      always {medical_device}
//   product_launch     always {saas}
//   hiring             from the company's industry; else {other}
//   website_visit      the owning team's default market; else {other}
//   positive_response  the owning team's default market; else from industry; else {other}
//   anything else      industry ∪ team default; else {other}
//
// A signal always has at least one market, so a "market = X" filter never
// silently drops unclassified signals into nowhere: they are 'other'.

import { isMarket, type Market } from "./signal-catalog.ts";

interface Rule {
  market: Exclude<Market, "other">;
  patterns: RegExp[];
}

const w = (s: string) => new RegExp(`(^|[^a-z0-9])${s}($|[^a-z0-9])`, "i");

// Order matters only for the order of the returned list (stable output).
export const MARKET_RULES: readonly Rule[] = [
  {
    market: "private_equity",
    patterns: [
      w("private equity"), w("venture capital & private equity"), w("investment banking"),
      w("mergers (and|&) acquisitions"), w("m&a"), w("business brokers?"), w("business brokerage"),
      w("sell(ing)? (my|our|a|the|your) (business|company)"), w("exit planning"), w("buy-?side"),
    ],
  },
  {
    market: "medical_device",
    patterns: [
      w("medical devices?"), w("medical equipment"), w("medical instruments?"), w("biotech(nology)?"),
      w("life sciences?"), w("in vitro diagnostics"), w("diagnostics"), w("510\\(k\\)"),
    ],
  },
  {
    market: "saas",
    patterns: [
      w("saas"), w("software"), w("computer software"), w("internet"), w("software as a service"),
      w("cloud software"), w("b2b software"),
    ],
  },
  {
    market: "recruiting",
    patterns: [
      w("staffing"), w("staffing (and|&) recruiting"), w("recruit(ing|ment|ers?)"), w("executive search"),
      w("talent acquisition"), w("headhunt(ing|ers?)"),
    ],
  },
];

/** Markets implied by free text (industry, keywords, description). Never includes 'other'. */
export function marketsFromText(...texts: Array<string | null | undefined | string[]>): Market[] {
  const hay = texts
    .flatMap((t) => (Array.isArray(t) ? t : [t]))
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .join(" | ");
  if (!hay) return [];
  return MARKET_RULES.filter((r) => r.patterns.some((p) => p.test(hay))).map((r) => r.market);
}

export interface MarketInput {
  /** Internal signal type. */
  signal_type: string;
  industry?: string | null;
  /** Company keywords / tags / description, any shape of text. */
  keywords?: string | string[] | null;
  /** The owning team's default market (teams.signals_default_market). */
  team_default_market?: string | null;
}

const uniq = (xs: Market[]): Market[] => [...new Set(xs)];

export function assignMarkets(i: MarketInput): Market[] {
  const team = isMarket(i.team_default_market) ? i.team_default_market : null;
  const fromIndustry = () => marketsFromText(i.industry, i.keywords ?? null);
  const orOther = (xs: Market[]): Market[] => (xs.length ? uniq(xs) : ["other"]);
  switch (i.signal_type) {
    case "fda_clearance":
      return ["medical_device"];
    case "product_launch":
      return ["saas"];
    case "hiring":
      return orOther(fromIndustry());
    case "website_visit":
      return orOther(team ? [team] : []);
    case "positive_response":
      return orOther(team ? [team] : fromIndustry());
    default:
      return orOther([...fromIndustry(), ...(team ? [team] : [])]);
  }
}
