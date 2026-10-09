// private_equity / seller_intent (admin-only). Logic: ./source.ts; pipeline: ../_shared/signals.ts.
import { serveSignalSource } from "../_shared/signals.ts";
import { fetchPeSellerIntent } from "./source.ts";

serveSignalSource("pe_seller_intent", fetchPeSellerIntent);
