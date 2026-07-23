// Idempotent seed script for the initial team accounts.
// Usage: node --env-file=.env.local scripts/seed-users.mjs
// Requires SUPABASE_SERVICE_ROLE_KEY to be set (Supabase Dashboard -> Settings -> API -> service_role).

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY belum diset. Tambahkan ke .env.local lalu jalankan lagi.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SHARED_PASSWORD = process.env.SEED_PASSWORD;
if (!SHARED_PASSWORD) {
  console.error('Set SEED_PASSWORD di environment sebelum menjalankan script ini (tidak disimpan di kode).');
  process.exit(1);
}

const USERS = [
  { full_name: 'Kelvin', email: 'kelvin.mahanaim@gmail.com', is_admin: false },
  { full_name: 'Liani', email: 'liani.mahanaim@gmail.com', is_admin: false },
  { full_name: 'Ika Yunita', email: 'ika.mahanaim@gmail.com', is_admin: false },
  { full_name: 'Valentino Pattikawa', email: 'valentino.mahanaim@gmail.com', is_admin: true },
  { full_name: 'Ike Finarsih', email: 'finarsih.mahanaim@gmail.com', is_admin: false },
  { full_name: 'Ilham Sepriadi', email: 'ilhams.mahanaim@gmail.com', is_admin: false },
];

async function findProfileByEmail(email) {
  const { data } = await supabaseAdmin.from('profiles').select('*').eq('email', email).maybeSingle();
  return data;
}

async function run() {
  for (const u of USERS) {
    const existing = await findProfileByEmail(u.email);
    if (existing) {
      console.log(`Sudah ada, dilewati: ${u.email}`);
      continue;
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: u.email,
      password: SHARED_PASSWORD,
      email_confirm: true,
    });
    if (createError) {
      console.error(`Gagal membuat auth user untuk ${u.email}:`, createError.message);
      continue;
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert([{ id: created.user.id, full_name: u.full_name, email: u.email, is_admin: u.is_admin }]);
    if (profileError) {
      console.error(`Gagal membuat profile untuk ${u.email}:`, profileError.message);
      continue;
    }

    console.log(`Dibuat: ${u.full_name} <${u.email}>${u.is_admin ? ' (admin)' : ''}`);
  }
  console.log('Selesai.');
}

run();
