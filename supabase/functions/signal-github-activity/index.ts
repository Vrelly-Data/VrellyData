// product_launch (market saas). Logic: ./source.ts; pipeline: ../_shared/signals.ts.
import { serveSignalSource } from "../_shared/signals.ts";
import { fetchGithubActivity } from "./source.ts";

serveSignalSource("github_activity", fetchGithubActivity);
