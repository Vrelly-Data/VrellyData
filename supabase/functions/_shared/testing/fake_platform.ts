// Test-only harness: drive a REAL edge-function handler (index.ts) against a
// fake PostgREST + fake provider APIs, recording every call.
//
// - loadHandler(url): stubs Deno.serve, imports the module through a
//   variable specifier (so `deno test` does not type-check supabase-js
//   against the repo's Vite tsconfig; index.ts is covered by `deno check`),
//   and returns the captured handler. Cached per module URL and serialised,
//   so several test files can load different handlers in one run.
// - FakeSupabase: a tiny in-memory PostgREST covering the operators these
//   handlers use (eq/neq/in/is/gt/gte/lt/lte, limit/offset, single/maybeSingle,
//   insert/upsert/update/delete). Unknown operators (or=, JSON paths, ilike,
//   not.*) are ignored, i.e. treated as matching. Per-table failure injection:
//   "error" (HTTP 500) or "hang" (never answers; rejects only when the
//   request's AbortSignal fires, like real fetch).
// - installFetch(): routes SUPA/rest/v1 to the fake DB, SUPA/functions/v1 to a
//   recorder, and anything else to a provider callback.
//
// Not imported by any function; never deployed.

export const SUPA = "http://supabase.test";
export const AGENT_KEY = "test-agent-key";
export const SERVICE_KEY = "test-service-role";

export function setTestEnv(): void {
  Deno.env.set("SUPABASE_URL", SUPA);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  Deno.env.set("SUPABASE_ANON_KEY", "test-anon");
  Deno.env.set("AGENT_API_KEY", AGENT_KEY);
}

export type Handler = (req: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
let loading: Promise<unknown> = Promise.resolve();

export function loadHandler(moduleUrl: string): Promise<Handler> {
  const run = loading.then(async () => {
    const cached = handlers.get(moduleUrl);
    if (cached) return cached;
    setTestEnv();
    let captured: Handler | null = null;
    const realServe = Deno.serve;
    // deno-lint-ignore no-explicit-any
    (Deno as any).serve = (a: unknown, b?: unknown) => {
      captured = (typeof a === "function" ? a : b) as Handler;
      return {
        finished: Promise.resolve(),
        shutdown: async () => {},
        ref() {},
        unref() {},
        addr: { hostname: "x", port: 0, transport: "tcp" },
      };
    };
    try {
      await import(moduleUrl);
    } finally {
      // deno-lint-ignore no-explicit-any
      (Deno as any).serve = realServe;
    }
    if (!captured) throw new Error(`${moduleUrl} did not register a Deno.serve handler`);
    handlers.set(moduleUrl, captured);
    return captured as Handler;
  });
  loading = run.catch(() => {});
  return run;
}

export type Row = Record<string, unknown>;
export type Failure = "error" | "hang";
export interface RestCall {
  method: string;
  table: string;
  params: URLSearchParams;
  body: unknown;
}

export class FakeSupabase {
  tables: Record<string, Row[]>;
  // key: "table" (any method) or "table:GET" / "table:WRITE"
  fail: Record<string, Failure> = {};
  // Finer-grained injection: first predicate returning a Failure wins.
  failIf: Array<(call: RestCall) => Failure | undefined> = [];
  rpc: Record<string, unknown> = {};
  calls: RestCall[] = [];
  aborted: string[] = [];
  private seq = 0;

  constructor(tables: Record<string, Row[]> = {}) {
    this.tables = structuredClone(tables);
  }

  writes(table: string): RestCall[] {
    return this.calls.filter((c) => c.table === table && c.method !== "GET" && c.method !== "HEAD");
  }
  reads(table: string): RestCall[] {
    return this.calls.filter((c) => c.table === table && (c.method === "GET" || c.method === "HEAD"));
  }

  private failureFor(table: string, method: string): Failure | undefined {
    const kind = method === "GET" || method === "HEAD" ? "GET" : "WRITE";
    return this.fail[`${table}:${kind}`] ?? this.fail[table];
  }

  private matches(row: Row, params: URLSearchParams): boolean {
    for (const [key, raw] of params) {
      if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
      if (key.includes("->") || key === "or" || key === "and") continue;
      const dot = raw.indexOf(".");
      if (dot < 0) continue;
      const op = raw.slice(0, dot);
      const val = raw.slice(dot + 1);
      const cell = row[key];
      const s = cell === null || cell === undefined ? null : String(cell);
      switch (op) {
        case "eq":
          if (s !== val) return false;
          break;
        case "neq":
          if (s === val) return false;
          break;
        case "in": {
          const list = val.replace(/^\(/, "").replace(/\)$/, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
          if (s === null || !list.includes(s)) return false;
          break;
        }
        case "is":
          if (val === "null" && s !== null) return false;
          if (val === "true" && cell !== true) return false;
          if (val === "false" && cell !== false) return false;
          break;
        case "gt": case "gte": case "lt": case "lte": {
          if (s === null) return false;
          const c = s < val ? -1 : s > val ? 1 : 0;
          if (op === "gt" && !(c > 0)) return false;
          if (op === "gte" && !(c >= 0)) return false;
          if (op === "lt" && !(c < 0)) return false;
          if (op === "lte" && !(c <= 0)) return false;
          break;
        }
        default:
          break; // ilike, not.*, fts, …: ignored
      }
    }
    return true;
  }

  async handle(req: Request, url: URL): Promise<Response> {
    const method = req.method.toUpperCase();
    const path = url.pathname.replace("/rest/v1/", "");
    const bodyText = method === "GET" || method === "HEAD" ? "" : await req.text();
    let body: unknown = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = bodyText;
    }
    if (path.startsWith("rpc/")) {
      const fn = path.slice(4);
      this.calls.push({ method, table: `rpc:${fn}`, params: url.searchParams, body });
      return json(fn in this.rpc ? this.rpc[fn] : null);
    }
    const table = path;
    this.calls.push({ method, table, params: url.searchParams, body });

    const call = this.calls[this.calls.length - 1];
    const failure = this.failIf.map((f) => f(call)).find(Boolean) ?? this.failureFor(table, method);
    if (failure === "hang") {
      return new Promise<Response>((_, reject) => {
        const onAbort = () => {
          this.aborted.push(`${method} ${table}`);
          reject(new DOMException("aborted", "AbortError"));
        };
        if (req.signal.aborted) onAbort();
        else req.signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (failure === "error") {
      return json({ code: "XX000", message: `simulated ${table} error`, details: null, hint: null }, 500);
    }

    const wantsObject = (req.headers.get("Accept") ?? "").includes("vnd.pgrst.object");
    const rowsOut = (rows: Row[], status = 200) => {
      if (wantsObject) {
        if (rows.length !== 1) {
          return json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null }, 406);
        }
        return json(rows[0], status);
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if ((req.headers.get("Prefer") ?? "").includes("count=")) {
        headers["Content-Range"] = `0-${Math.max(rows.length - 1, 0)}/${rows.length}`;
      }
      if (method === "HEAD") return new Response(null, { status, headers });
      return new Response(JSON.stringify(rows), { status, headers });
    };

    const all = (this.tables[table] ??= []);
    const matched = all.filter((r) => this.matches(r, url.searchParams));

    if (method === "GET" || method === "HEAD") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = url.searchParams.get("limit");
      const page = matched.slice(offset, limit ? offset + Number(limit) : undefined);
      return rowsOut(page);
    }
    if (method === "POST") {
      let items = (Array.isArray(body) ? body : [body]) as Row[];
      // Emulates migration 20261007210000's BEFORE INSERT trigger: a new
      // synced_campaigns row takes capture_enabled from its integration's
      // auto_capture_new_campaigns (column default true). ON CONFLICT DO
      // NOTHING (ignore-duplicates upserts) leaves existing rows untouched.
      if (table === "synced_campaigns") {
        const ignoreDup = (req.headers.get("Prefer") ?? "").includes("resolution=ignore-duplicates");
        const ints = this.tables.outbound_integrations ?? [];
        items = items
          .filter((r) => !ignoreDup || !all.some((e) => e.integration_id === r.integration_id && String(e.external_campaign_id) === String(r.external_campaign_id)))
          .map((r) => {
            const integ = ints.find((i) => i.id === r.integration_id);
            return integ ? { ...r, capture_enabled: integ.auto_capture_new_campaigns !== false } : r;
          });
      }
      const out = items.map((r) => ({ id: `${table}-${++this.seq}`, ...r }));
      all.push(...out);
      return rowsOut(out, 201);
    }
    if (method === "PATCH") {
      for (const r of matched) Object.assign(r, body as Row);
      return rowsOut(matched);
    }
    if (method === "DELETE") {
      this.tables[table] = all.filter((r) => !matched.includes(r));
      return rowsOut(matched);
    }
    return json({ message: `unsupported ${method}` }, 405);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export type ProviderFn = (req: Request, url: URL) => Response | Promise<Response> | undefined;

export interface Recorder {
  functionCalls: { path: string; body: unknown }[];
  providerCalls: { method: string; url: string; body: unknown }[];
  logs: string[];
}

// Installs the fetch stub (and silences + records console.log/warn) for the
// duration of fn.
export async function withFakes<T>(
  db: FakeSupabase,
  provider: ProviderFn,
  fn: (rec: Recorder) => Promise<T>,
): Promise<{ result: T; rec: Recorder }> {
  const rec: Recorder = { functionCalls: [], providerCalls: [], logs: [] };
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realWarn = console.warn;
  const realErr = console.error;
  const capture = (...args: unknown[]) => {
    rec.logs.push(args.map((a) => (typeof a === "string" ? a : safeString(a))).join(" "));
  };
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  globalThis.fetch = async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    if (url.origin === SUPA && url.pathname.startsWith("/rest/v1/")) return db.handle(req, url);
    if (url.origin === SUPA && url.pathname.startsWith("/functions/v1/")) {
      const t = await req.text();
      let b: unknown = t;
      try { b = JSON.parse(t); } catch { /* keep text */ }
      rec.functionCalls.push({ path: url.pathname, body: b });
      return json({ ok: true });
    }
    let b: unknown = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const t = await req.clone().text();
      try { b = JSON.parse(t); } catch { b = t; }
    }
    rec.providerCalls.push({ method: req.method, url: url.toString(), body: b });
    const res = await provider(req, url);
    if (res) return res;
    throw new Error(`unexpected fetch in test: ${req.method} ${req.url}`);
  };
  try {
    const result = await fn(rec);
    // Let fire-and-forget promises started by the handler settle while the
    // stub is still installed.
    await new Promise((r) => setTimeout(r, 10));
    return { result, rec };
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.warn = realWarn;
    console.error = realErr;
  }
}

function safeString(v: unknown): string {
  try {
    return v instanceof Error ? v.message : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const noProviders: ProviderFn = () => undefined;
export const testOpts = { sanitizeOps: false, sanitizeResources: false };
