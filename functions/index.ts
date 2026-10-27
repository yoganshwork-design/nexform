import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { serveSite } from "./adapter.mjs";
import { handler } from "./handler.mjs";

Deno.serve(serveSite(handler, {
  createClient,
  env: (name: string) => Deno.env.get(name),
}));
