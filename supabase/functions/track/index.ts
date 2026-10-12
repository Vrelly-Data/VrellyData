// Public pixel endpoint (verify_jwt = false). Logic: ./handler.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleTrack } from "./handler.ts";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve((req) => handleTrack(req, { supabase, salt: Deno.env.get("PIXEL_IP_SALT") ?? "" }));
