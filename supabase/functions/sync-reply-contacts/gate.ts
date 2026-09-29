import { isTrustedServiceCaller } from "./auth.ts";

export type AuthDecision = "service" | "user" | "unauthorized";

// Decide auth path without performing DB lookups:
// - "service" when a trusted service caller is detected
// - "user" when a user token is present and validated by getUser()
// - "unauthorized" otherwise
//
// getUserIsValid must be provided by the caller (index.ts) to avoid coupling
// tests to network calls.
export async function decideAuth(
  headers: Headers,
  getUserIsValid: () => Promise<boolean>,
): Promise<AuthDecision> {
  if (isTrustedServiceCaller(headers)) return "service";
  const authHeader = headers.get("Authorization");
  if (!authHeader) return "unauthorized";
  const ok = await getUserIsValid();
  return ok ? "user" : "unauthorized";
}

