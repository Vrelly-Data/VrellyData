import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeLinkedinUrlForStorage } from "./normalize.ts";

Deno.test("sanitizeLinkedinUrlForStorage maps empty to null", () => {
  assertEquals(sanitizeLinkedinUrlForStorage(""), null);
  assertEquals(sanitizeLinkedinUrlForStorage("   "), null);
  assertEquals(sanitizeLinkedinUrlForStorage(null), null);
  assertEquals(sanitizeLinkedinUrlForStorage(undefined), null);
});

Deno.test('sanitizeLinkedinUrlForStorage maps literal "0" to null', () => {
  assertEquals(sanitizeLinkedinUrlForStorage("0"), null);
  assertEquals(sanitizeLinkedinUrlForStorage(" 0 "), null);
});

Deno.test("sanitizeLinkedinUrlForStorage keeps non-empty values", () => {
  assertEquals(sanitizeLinkedinUrlForStorage("https://www.linkedin.com/in/jane"), "https://www.linkedin.com/in/jane");
  assertEquals(sanitizeLinkedinUrlForStorage("linkedin.com/in/jane"), "linkedin.com/in/jane");
});

