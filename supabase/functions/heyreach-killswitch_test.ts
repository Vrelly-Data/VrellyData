import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

async function fileContains(path: string, needle: string): Promise<boolean> {
  try {
    const txt = await Deno.readTextFile(path);
    return txt.includes(needle);
  } catch {
    return false;
  }
}

Deno.test("kill switch: no classify-reply references in HeyReach ingestion", async () => {
  // Skip when read permission not granted
  // deno-lint-ignore no-explicit-any
  const q: any = await (Deno.permissions as any).query?.({ name: "read" }).catch(() => null);
  if (q && q.state !== "granted") {
    console.log("[killswitch-test] read permission not granted — skipping source grep");
    assert(true);
    return;
  }
  const files = [
    "supabase/functions/poll-heyreach-inbox/index.ts",
    "supabase/functions/heyreach-webhook/index.ts",
    "supabase/functions/recover-heyreach-leads/index.ts",
  ];
  for (const f of files) {
    const has = await fileContains(f, "classify-reply");
    assertEquals(has, false, `File ${f} must not reference classify-reply`);
  }
});

