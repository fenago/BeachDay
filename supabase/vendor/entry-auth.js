// esbuild entry for the vendored Console auth client (ADR-0006; software-architect example 04).
// Auth only: no PostgREST, Realtime, Storage or Functions code. The Console needs the client and the
// one error test it uses to tell an outage (503 wording) from a rejected credential.
export { AuthClient, isAuthRetryableFetchError } from "@supabase/auth-js";
