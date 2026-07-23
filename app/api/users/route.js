import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getUserFromRequest, unauthorized } from '../../../lib/serverAuth';

// Minimal directory of registered users, for the recipient picker when sending a
// document. Any authenticated user may read this (no is_admin/sensitive fields exposed).
export async function GET(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email')
    .order('full_name', { ascending: true });

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ users: data }), { status: 200 });
}
