import { createClient } from '@supabase/supabase-js';

// The client is built on first use, never at import time.
//
// `next build` evaluates every route module to collect page data, and during
// the build there are no environment variables. Constructing the client at
// module scope threw "supabaseUrl is required" and failed the whole build
// before a single request was ever served.

let cached = null;

function client() {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Vercel, Settings, Environment Variables'
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Behaves like a Supabase client, but only constructs one when touched. */
export const db = new Proxy(
  {},
  {
    get(_target, prop) {
      const c = client();
      const value = c[prop];
      return typeof value === 'function' ? value.bind(c) : value;
    },
  }
);

export function shape(row) {
  if (!row) return null;
  return {
    ...row,
    use_cases: row.use_cases ?? [],
    tags: row.tags ?? [],
    collections: row.collections ?? [],
  };
}
