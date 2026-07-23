import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getUserFromRequest, unauthorized, forbidden } from '../../../../lib/serverAuth';

export async function GET(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();
  if (!auth.profile.is_admin) return forbidden();

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, is_admin, created_at')
    .order('created_at', { ascending: true });

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ users: data }), { status: 200 });
}

export async function POST(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();
  if (!auth.profile.is_admin) return forbidden();

  const { full_name, email, password } = await request.json();
  if (!full_name || !email || !password) {
    return new Response(JSON.stringify({ error: 'Nama, email, dan password wajib diisi.' }), { status: 400 });
  }
  if (password.length < 6) {
    return new Response(JSON.stringify({ error: 'Password minimal 6 karakter.' }), { status: 400 });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    return new Response(JSON.stringify({ error: createError.message }), { status: 400 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .insert([{ id: created.user.id, full_name, email, is_admin: false }])
    .select()
    .single();

  if (profileError) {
    return new Response(JSON.stringify({ error: profileError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ user: profile }), { status: 200 });
}
