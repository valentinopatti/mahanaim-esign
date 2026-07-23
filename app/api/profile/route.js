import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getUserFromRequest, unauthorized } from '../../../lib/serverAuth';

export async function GET(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();
  return new Response(JSON.stringify({ profile: auth.profile }), { status: 200 });
}

export async function PATCH(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();

  const { full_name, saved_signature } = await request.json();
  const updates = {};
  if (typeof full_name === 'string' && full_name.trim()) updates.full_name = full_name.trim();
  if (typeof saved_signature === 'string' || saved_signature === null) updates.saved_signature = saved_signature;

  if (Object.keys(updates).length === 0) {
    return new Response(JSON.stringify({ error: 'Tidak ada perubahan.' }), { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', auth.user.id)
    .select()
    .single();

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ profile: data }), { status: 200 });
}
