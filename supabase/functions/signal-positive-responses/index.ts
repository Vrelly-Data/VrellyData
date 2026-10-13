// positive_response — "High Intent" to clients (admin-only views may show the
// source detail). Logic: ./source.ts; enrichment: ../_shared/signal-enrichment.ts;
// pipeline: ../_shared/signals.ts.
import { serveSignalSource } from "../_shared/signals.ts";
import { enrichPositiveResponses, fetchPositiveResponses } from "./source.ts";

serveSignalSource("positive_responses", fetchPositiveResponses, enrichPositiveResponses);
