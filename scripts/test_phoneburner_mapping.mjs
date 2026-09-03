#!/usr/bin/env node
// Minimal tests for PhoneBurner MVP helpers: phone normalize, disposition mapping,
// person match order (email-first). No external libs; prints PASS/FAIL.

function normalizePhoneE164(input) {
  const s = typeof input === "string" ? input : String(input ?? "");
  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 11) return `+${digits}`;
  return null;
}

function mapDispositionToInference(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const noise = ["no answer", "left message", "left vm", "busy", "callback", "call back", "wrong number"];
  if (noise.some((k) => s.includes(k))) return null;
  if (["appointment", "appt", "meeting", "booked", "scheduled"].some((k) => s.includes(k))) {
    return { event_type: "meeting_booked" };
  }
  if (s.includes("dnc") || s.includes("do not call") || s.includes("do-not-call")) {
    return { event_type: "opted_out" };
  }
  if (["not interested", "no interest", "not a fit", "no fit", "no thanks", "no thank"].some((k) => s.includes(k))) {
    return { event_type: "classified", intent: "not_interested" };
  }
  return null;
}

function pickPersonKey({ email, phone_e164 }, { havePeopleEmail, haveAgentLeadsEmail, haveSyncedContactsEmail }) {
  // MVP rule: email-first — if an email exists, person_key is lower(email) regardless of phone.
  if (email && email.trim()) return email.trim().toLowerCase();
  // Fallback via phone to synced_contacts.phone is not implemented in MVP DB; return null
  return null;
}

function assertEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAIL: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

try {
  // Phone normalization
  assertEq(normalizePhoneE164("123-456-7890"), "+11234567890", "US 10-digit -> +1");
  assertEq(normalizePhoneE164("(312) 555-1212"), "+13125551212", "US area code parse");
  assertEq(normalizePhoneE164("+44 20 7946 0958"), "+442079460958", "E.164 keep non-US");
  assertEq(normalizePhoneE164(""), null, "empty -> null");

  // Disposition mapping
  assertEq(mapDispositionToInference("Appointment Scheduled")?.event_type, "meeting_booked", "appointment -> meeting_booked");
  assertEq(mapDispositionToInference("Meeting booked")?.event_type, "meeting_booked", "meeting -> meeting_booked");
  assertEq(mapDispositionToInference("not interested")?.intent, "not_interested", "not interested -> classified/not_interested");
  assertEq(mapDispositionToInference("DNC")?.event_type, "opted_out", "DNC -> opted_out");
  assertEq(mapDispositionToInference("No Answer"), null, "no answer -> no inference");
  assertEq(mapDispositionToInference("Left Message"), null, "left message -> no inference");

  // Person match: email-first
  assertEq(
    pickPersonKey({ email: "Case@Example.com", phone_e164: "+13125551212" }, { havePeopleEmail: true }),
    "case@example.com",
    "email normalized to lower()"
  );
  assertEq(
    pickPersonKey({ email: "", phone_e164: "+13125551212" }, {}),
    null,
    "no email -> null (no phone-to-synced_contacts in MVP)"
  );

  console.log("All PhoneBurner mapping tests: PASS");
} catch (e) {
  console.error(String(e?.message || e));
  process.exit(1);
}

