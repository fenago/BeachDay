// Fixture config for the local harness and e2e (what scripts/gen-config.mjs writes in a real build).
// Non-secret fakes: the host does not exist and the key means nothing to any real project.
export const SUPABASE_URL = "https://bdlocaltest.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_bdlocaltest_0000000000000000";
export const BUILD_VERSION = "fixture0000000000000000000000000000000000";
