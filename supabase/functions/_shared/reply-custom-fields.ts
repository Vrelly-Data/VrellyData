// Ensure Reply.io custom fields exist in the workspace, idempotently.
//
// Same pattern as send-agent-reply's ensureMessageCustomField (not imported:
// that function is private to a module that also starts a server): v3 silently
// DROPS customFields writes for a name not registered under /v3/custom-fields,
// so register first — GET the list, POST {title, fieldType:'text'} for each
// missing name, and treat 409 (duplicate name) as success.

const REPLY_API_V3 = "https://api.reply.io/v3";

export async function ensureReplyCustomFields(
  apiKey: string,
  names: string[],
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" };
  const listRes = await fetchFn(`${REPLY_API_V3}/custom-fields`, { headers });
  if (!listRes.ok) {
    throw new Error(`list custom fields ${listRes.status}: ${(await listRes.text().catch(() => "")).slice(0, 200)}`);
  }
  const list = await listRes.json().catch(() => []);
  const have = new Set(
    (Array.isArray(list) ? list : []).map((f: { title?: string }) => String(f?.title ?? "").trim().toLowerCase()),
  );
  for (const name of names) {
    if (have.has(name.toLowerCase())) continue;
    const res = await fetchFn(`${REPLY_API_V3}/custom-fields`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: name, fieldType: "text" }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`create custom field '${name}' ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
  }
}
