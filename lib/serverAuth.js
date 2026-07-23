import { supabaseAdmin } from './supabaseAdmin';

// Extracts the Bearer token from an incoming Request, verifies it against Supabase Auth,
// and loads the matching profiles row. Returns null if not authenticated.
export async function getUserFromRequest(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) return null;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .single();
  if (profileError || !profile) return null;

  return { user: userData.user, profile };
}

export function unauthorized(message = 'Unauthorized') {
  return new Response(JSON.stringify({ error: message }), { status: 401 });
}

export function forbidden(message = 'Forbidden') {
  return new Response(JSON.stringify({ error: message }), { status: 403 });
}
