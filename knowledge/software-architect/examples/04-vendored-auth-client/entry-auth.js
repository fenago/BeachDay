// esbuild entry for the vendored Console auth client (ADR-0006). Auth only: no PostgREST, Realtime, Storage or Functions code.
export { AuthClient } from "@supabase/auth-js";
