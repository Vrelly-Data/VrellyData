// fda_clearance (market medical_device). Logic: ./source.ts; pipeline: ../_shared/signals.ts.
import { serveSignalSource } from "../_shared/signals.ts";
import { fetchOpenFda510k } from "./source.ts";

serveSignalSource("openfda_510k", fetchOpenFda510k);
