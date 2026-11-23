// One place that opens Blobs stores, so tests can swap in a fake store.
// Real code: site-wide stores (survive deploys) with strong consistency,
// because job/proposal state and counters must never read stale data.
import { getStore } from "@netlify/blobs";

let factory = (name) => getStore({ name, consistency: "strong" });

export function store(name) {
  return factory(name);
}

// Test hook only. Production code never calls this.
export function setStoreFactory(fn) {
  factory = fn;
}
