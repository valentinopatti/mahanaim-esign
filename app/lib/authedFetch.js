'use client';

import { supabase } from './supabaseClient';

// Wraps fetch() to our own /api/* routes, attaching the current session's access token
// so server routes can identify the caller via lib/serverAuth.js.
export async function authedFetch(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  return fetch(path, { ...options, headers });
}
