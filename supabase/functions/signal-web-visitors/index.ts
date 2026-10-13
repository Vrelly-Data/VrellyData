// website_visit rollup. Logic: ./source.ts; pipeline: ../_shared/signals.ts.
import { serveSignalSource } from "../_shared/signals.ts";
import { fetchWebVisitors } from "./source.ts";

serveSignalSource("web_visitors", fetchWebVisitors);
