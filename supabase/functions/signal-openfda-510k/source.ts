// medical_device / 510k_cleared — FDA 510(k) clearances from openFDA.
//
// https://api.fda.gov/device/510k.json, decision_date in the last N days
// (config: lookback_days_initial on the first run, lookback_days after),
// paged with limit + skip. Response shape verified live 2026-10-09:
//   { meta: { last_updated, results: { skip, limit, total } },
//     results: [{ k_number, applicant, contact, device_name, product_code,
//                 decision_date 'YYYY-MM-DD', decision_code, decision_description,
//                 city, state, country_code, zip_code, clearance_type, date_received,
//                 openfda: { device_name?, medical_specialty_description?, ... } }] }
// openFDA publishes weekly (last_updated lags), so lookback_days must cover a
// week+; overlap is free because the dedupe key is the k_number.

import { clampScore, collapseSpaces, dedupeKey, type FetchResult, type SignalInput, type SourceContext, toIso } from "../_shared/signals.ts";

export const OPENFDA_510K_URL = "https://api.fda.gov/device/510k.json";

export interface Fda510k {
  k_number?: string;
  applicant?: string;
  contact?: string;
  device_name?: string;
  product_code?: string;
  decision_date?: string;
  decision_code?: string;
  decision_description?: string;
  city?: string;
  state?: string;
  country_code?: string;
  zip_code?: string;
  clearance_type?: string;
  date_received?: string;
  third_party_flag?: string;
  review_advisory_committee?: string;
  openfda?: Record<string, unknown>;
}

export function fda510kUrl(kNumber: string): string {
  return `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${encodeURIComponent(kNumber)}`;
}

/** Score: a cleared device is the event; US applicants and recency rank higher. */
export function score510k(r: Fda510k, now: number): number {
  let s = 50;
  if ((r.decision_description ?? "").toLowerCase().includes("substantially equivalent")) s += 10;
  if ((r.country_code ?? "").toUpperCase() === "US") s += 15;
  const at = toIso(r.decision_date);
  const days = at ? (now - Date.parse(at)) / 86_400_000 : 999;
  if (days <= 7) s += 20;
  else if (days <= 30) s += 10;
  if (collapseSpaces(r.contact)) s += 5;
  return clampScore(s);
}

export function map510k(r: Fda510k, now = Date.now()): SignalInput | null {
  const k = collapseSpaces(r.k_number);
  const occurred = toIso(r.decision_date);
  if (!k || !occurred) return null;
  const applicant = collapseSpaces(r.applicant);
  const device = collapseSpaces(r.device_name) ?? collapseSpaces(r.openfda?.device_name as string | undefined);
  return {
    signal_type: "510k_cleared",
    occurred_at: occurred,
    dedupe_key: dedupeKey("510k", k),
    title: `${applicant ?? "Unknown applicant"} cleared ${k}${device ? `: ${device}` : ""}`.slice(0, 500),
    url: fda510kUrl(k),
    score: score510k(r, now),
    company_name: applicant,
    person_name: collapseSpaces(r.contact),
    city: collapseSpaces(r.city),
    state: collapseSpaces(r.state),
    country: collapseSpaces(r.country_code),
    payload: {
      k_number: k,
      device_name: device,
      product_code: collapseSpaces(r.product_code),
      decision_code: collapseSpaces(r.decision_code),
      decision_description: collapseSpaces(r.decision_description),
      clearance_type: collapseSpaces(r.clearance_type),
      date_received: collapseSpaces(r.date_received),
      third_party_flag: collapseSpaces(r.third_party_flag),
      review_advisory_committee: collapseSpaces(r.review_advisory_committee),
      zip_code: collapseSpaces(r.zip_code),
      medical_specialty: (r.openfda?.medical_specialty_description as string | undefined) ?? null,
      device_class: (r.openfda?.device_class as string | undefined) ?? null,
    },
  };
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

export async function fetchOpenFda510k(ctx: SourceContext): Promise<FetchResult> {
  const c = ctx.config;
  const days = Number(ctx.lastSuccessAt ? c.lookback_days ?? 10 : c.lookback_days_initial ?? 30);
  const pageSize = Math.min(Number(c.page_size ?? 100), 1000);
  const maxPages = Number(c.max_pages ?? 50);
  const from = ymd(ctx.now - days * 86_400_000);
  const to = ymd(ctx.now);

  const signals: SignalInput[] = [];
  let fetched = 0, total = 0, pages = 0, lastUpdated: string | null = null;
  let error: string | null = null;
  for (let skip = 0; pages < maxPages; skip += pageSize) {
    const url = `${OPENFDA_510K_URL}?search=decision_date:[${from}+TO+${to}]&sort=decision_date:desc&limit=${pageSize}&skip=${skip}`;
    const res = await ctx.fetchFn(url, { signal: AbortSignal.timeout(30_000) });
    pages++;
    if (res.status === 404) break; // openFDA: "No matches found!"
    if (!res.ok) {
      error = `openFDA HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      break;
    }
    const body = await res.json();
    const results = (body?.results ?? []) as Fda510k[];
    total = Number(body?.meta?.results?.total ?? 0);
    lastUpdated = body?.meta?.last_updated ?? lastUpdated;
    fetched += results.length;
    for (const r of results) {
      const s = map510k(r, ctx.now);
      if (s) signals.push(s);
    }
    if (results.length < pageSize || skip + pageSize >= total) break;
  }
  if (!error && fetched < total) error = `stopped at max_pages=${maxPages}: ${fetched} of ${total}`;
  return { signals, fetched, error, detail: { window_days: days, from, to, total, pages, last_updated: lastUpdated } };
}
