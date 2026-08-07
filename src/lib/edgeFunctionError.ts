// Recover an edge function's real error message from a supabase-js invoke().
//
// THE PROBLEM. supabase-js throws on ANY non-2xx BEFORE reading the body:
//
//   // @supabase/functions-js FunctionsClient.js:92
//   if (!response.ok) { throw new FunctionsHttpError(response); }
//
// FunctionsHttpError's message is the fixed string 'Edge Function returned a
// non-2xx status code' (types.js:20), and invoke() returns { data: null, error }.
// So the common call-site shape
//
//   if (error) throw new Error(error.message);   // <- always the generic string
//   if (data?.error) throw new Error(data.error); // <- unreachable, data is null
//
// can only ever surface the generic string, and the second line is dead code on
// every 4xx. Our edge functions return their real, operator-facing reason as
// { error, code } in that body — send-agent-reply alone has five distinct 400s
// ('Channel mismatch: …', 'No campaign mapped for this intent',
// 'invalid_thread_reference', 'thread_unresolved', missing-fields) — and none of
// them reached the operator. Toasts that branched on those strings never fired.
//
// THE FIX. FunctionsHttpError carries the raw Response on `.context`, unread.
// Parsing it recovers both the message and the machine-readable code.
export interface EdgeFunctionError {
  message: string;
  /** Machine-readable discriminator from the body, e.g. 'invalid_thread_reference'. */
  code?: string;
}

export async function parseEdgeFunctionError(
  error: unknown,
  fallback: string,
): Promise<EdgeFunctionError> {
  const err = error as { context?: unknown; message?: unknown } | null | undefined;
  const ctx = err?.context as Response | undefined;

  // .context is the untouched Response on FunctionsHttpError. Clone before
  // reading: a Response body can only be consumed once, and something upstream
  // may already have read it (or may want to later).
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const res = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
      const body = await res.json();
      const message = typeof body?.error === 'string' ? body.error.trim() : '';
      const code = typeof body?.code === 'string' ? body.code : undefined;
      if (message) return { message, code };
    } catch {
      // Body wasn't JSON, or was already consumed. Fall through.
    }
  }

  // Network failures (FunctionsFetchError) carry a genuinely useful message;
  // only the non-2xx placeholder is worth discarding.
  const raw = typeof err?.message === 'string' ? err.message.trim() : '';
  if (raw && !/non-2xx status code/i.test(raw)) return { message: raw };

  return { message: fallback };
}

// Throwable form: react-query mutations surface a thrown Error to onError, so
// carry `code` on the Error for callers that want to branch on it rather than
// on message text.
export async function edgeFunctionError(
  error: unknown,
  fallback: string,
): Promise<Error & { code?: string }> {
  const { message, code } = await parseEdgeFunctionError(error, fallback);
  const e = new Error(message) as Error & { code?: string };
  if (code) e.code = code;
  return e;
}
