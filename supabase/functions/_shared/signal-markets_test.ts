// Market assignment: industry/keyword rules and the per-type strategy.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assignMarkets, marketsFromText } from "./signal-markets.ts";
import { internalTypeKey, publicTypeKey, PUBLIC_TYPE_LABEL, highIntentTitle } from "./signal-catalog.ts";

Deno.test("marketsFromText: industry → market, whole words, case-insensitive", () => {
  assertEquals(marketsFromText("Medical Devices"), ["medical_device"]);
  assertEquals(marketsFromText("Medical Equipment Manufacturing"), ["medical_device"]);
  assertEquals(marketsFromText("Biotechnology Research"), ["medical_device"]);
  assertEquals(marketsFromText("Computer Software"), ["saas"]);
  assertEquals(marketsFromText("SaaS"), ["saas"]);
  assertEquals(marketsFromText("Internet"), ["saas"]);
  assertEquals(marketsFromText("Staffing and Recruiting"), ["recruiting"]);
  assertEquals(marketsFromText("Executive Search"), ["recruiting"]);
  assertEquals(marketsFromText("Venture Capital & Private Equity"), ["private_equity"]);
  assertEquals(marketsFromText("Investment Banking"), ["private_equity"]);
  assertEquals(marketsFromText("Mergers and Acquisitions advisory"), ["private_equity"]);
  assertEquals(marketsFromText(null, "business brokers, exit planning"), ["private_equity"]);
  assertEquals(marketsFromText(null, ["looking to sell my business"]), ["private_equity"]);
});

Deno.test("marketsFromText: no false positives on look-alike words; several markets when several apply", () => {
  assertEquals(marketsFromText("Construction"), []);
  assertEquals(marketsFromText("Information Technology & Services"), []);
  assertEquals(marketsFromText("Hospital & Health Care"), []);
  assertEquals(marketsFromText("Recruitmentality Ltd"), [], "whole words only");
  assertEquals(marketsFromText("Softwarehouse"), [], "whole words only");
  assertEquals(marketsFromText("", null, undefined, []), []);
  assertEquals(marketsFromText("Computer Software", "recruiting platform for staffing agencies"), ["saas", "recruiting"]);
});

Deno.test("assignMarkets: per-type strategy", () => {
  assertEquals(assignMarkets({ signal_type: "fda_clearance", industry: "Computer Software" }), ["medical_device"]);
  assertEquals(assignMarkets({ signal_type: "product_launch" }), ["saas"]);
  assertEquals(assignMarkets({ signal_type: "hiring", industry: "Staffing and Recruiting" }), ["recruiting"]);
  assertEquals(assignMarkets({ signal_type: "hiring", industry: "Computer Software" }), ["saas"]);
  assertEquals(assignMarkets({ signal_type: "hiring", industry: null }), ["other"]);
  assertEquals(assignMarkets({ signal_type: "hiring", industry: "Construction", team_default_market: "saas" }), ["other"],
    "hiring ignores the team default: it is about the hiring company");
  assertEquals(assignMarkets({ signal_type: "website_visit", team_default_market: "saas" }), ["saas"]);
  assertEquals(assignMarkets({ signal_type: "website_visit" }), ["other"]);
  assertEquals(assignMarkets({ signal_type: "positive_response", industry: "Computer Software", team_default_market: "private_equity" }),
    ["private_equity"], "the team default wins for High Intent");
  assertEquals(assignMarkets({ signal_type: "positive_response", industry: "Computer Software" }), ["saas"]);
  assertEquals(assignMarkets({ signal_type: "positive_response" }), ["other"]);
  assertEquals(assignMarkets({ signal_type: "positive_response", team_default_market: "not_a_market" }), ["other"]);
  assertEquals(assignMarkets({ signal_type: "something_new", industry: "Medical Devices", team_default_market: "saas" }), ["medical_device", "saas"]);
});

Deno.test("catalog: public keys and labels never say 'positive response'", () => {
  assertEquals(publicTypeKey("positive_response"), "high_intent");
  assertEquals(publicTypeKey("fda_clearance"), "fda_clearance");
  assertEquals(internalTypeKey("high_intent"), "positive_response");
  assertEquals(internalTypeKey("HIGH_INTENT"), "positive_response");
  assertEquals(internalTypeKey("hiring"), "hiring");
  assertEquals(internalTypeKey("vertical"), null);
  assertEquals(PUBLIC_TYPE_LABEL.positive_response, "High Intent");
  for (const label of Object.values(PUBLIC_TYPE_LABEL)) {
    assertEquals(/positive|interested|repl/i.test(label), false, label);
  }
  assertEquals(highIntentTitle({ name: "Ann Lee", title: "CEO", company: "Acme" }), "High intent: Ann Lee, CEO at Acme");
  assertEquals(highIntentTitle({ name: "Ann Lee", company: "Acme" }), "High intent: Ann Lee at Acme");
  assertEquals(highIntentTitle({ company: "Acme" }), "High intent: Acme");
  assertEquals(highIntentTitle({}), "High intent: Unnamed contact");
});
