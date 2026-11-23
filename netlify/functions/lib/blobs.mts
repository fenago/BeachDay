// The one place that opens Netlify Blobs stores (docs/03 §7).
// Site-wide stores (getStore, not getDeployStore) so state survives deploys, always with strong
// consistency: proposals, jobs and counters must never read a value up to 60 s old.
// There is no global test hook. Handlers take a `Stores` dependency; tests inject a fake.
import { getStore } from "@netlify/blobs";

export interface BlobEntry<T = unknown> { data: T; etag: string; metadata: Record<string, unknown> }
export interface WriteResult { modified: boolean; etag?: string }
export interface WriteOptions { onlyIfNew?: boolean; onlyIfMatch?: string; metadata?: Record<string, unknown> }

// The subset of the Blobs store API this project uses. A fake in tests implements the same methods.
export interface BlobStore {
  getWithMetadata(key: string, opts: { type: "json" }): Promise<BlobEntry | null>;
  setJSON(key: string, value: unknown, opts?: WriteOptions): Promise<WriteResult>;
  list(opts?: { prefix?: string }): Promise<{ blobs: { key: string; etag?: string }[]; directories?: string[] }>;
  delete(key: string): Promise<void>;
}

// Store names: at most 64 bytes, no "/" or ":". Keys: at most 600 bytes.
export const STORE_NAMES = Object.freeze({
  proposals: "proposals",
  jobs: "jobs",
  ratelimit: "ratelimit",
  audit: "audit",
} as const);

export type StoreName = keyof typeof STORE_NAMES;
export type Stores = Record<StoreName, BlobStore>;

export function openStore(name: StoreName): BlobStore {
  return getStore({ name: STORE_NAMES[name], consistency: "strong" }) as unknown as BlobStore;
}

// Opened lazily and once each, so importing a handler never touches Blobs.
export function realStores(): Stores {
  const cache: Partial<Stores> = {};
  const get = (name: StoreName): BlobStore => (cache[name] ??= openStore(name));
  return {
    get proposals() { return get("proposals"); },
    get jobs() { return get("jobs"); },
    get ratelimit() { return get("ratelimit"); },
    get audit() { return get("audit"); },
  };
}
