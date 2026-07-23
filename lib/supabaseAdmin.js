import { createClient } from '@supabase/supabase-js';

// Server-only client. Uses the service-role key, which bypasses Row Level Security,
// so this file must never be imported from a 'use client' component.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY belum diset — semua route yang butuh akses data akan gagal sampai diisi.');
}

// Falls back to a placeholder so createClient doesn't throw at module-load time
// (which would otherwise crash every route/build that imports this file); real
// calls will simply fail with an auth error until the real key is set.
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey || 'missing-service-role-key', {
  auth: { autoRefreshToken: false, persistSession: false },
});
