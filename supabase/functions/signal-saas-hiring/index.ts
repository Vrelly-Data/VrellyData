// saas_hiring / job_posted. Logic: ./source.ts; pipeline: ../_shared/signals.ts.
import { serveSignalSource } from "../_shared/signals.ts";
import { fetchSaasHiring } from "./source.ts";

serveSignalSource("saas_hiring", fetchSaasHiring);
