import { createClient } from '@supabase/supabase-js';

// --- PASTIKAN ALAMAT URL HANYA SAMPAI ".co" SAJA (TANPA / ATAU /rest/v1 DI UJUNGNYA) ---
const supabaseUrl = 'https://khlpzyyshtuwronalntr.supabase.co'; 
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtobHB6eXlzaHR1d3JvbmFsbnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzY3NzQsImV4cCI6MjA5OTY1Mjc3NH0.pgxKvHCXl-ah4GbhMCbgNQ3dRNx-J1dWIwVNJNKVYCQ'; // Isi dengan sisa key panjang Anda
// -------------------------------------------------------------------------------------

// Baris pengaman otomatis untuk membersihkan sisa garis miring jika tidak sengaja ketik
const cleanUrl = supabaseUrl.replace(/\/$/, "").replace(/\/rest\/v1$/, "");

const supabase = createClient(cleanUrl, supabaseAnonKey);

export async function POST(request) {
  try {
    const formData = await request.formData();
    const signer_email = formData.get('signer_email');
    const signer_name = formData.get('signer_name');
    const file = formData.get('file');

    if (!file) {
      return new Response(JSON.stringify({ error: "File tidak ditemukan" }), { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileBase64 = `data:${file.type};base64,${buffer.toString('base64')}`;

    const { data, error } = await supabase
      .from('documents')
      .insert([
        { 
          signer_email, 
          signer_name, 
          file_name: file.name,
          file_url: fileBase64,
          status: 'SENT'
        }
      ])
      .select();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, docId: data[0].id }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}