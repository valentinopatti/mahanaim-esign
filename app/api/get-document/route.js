import { createClient } from '@supabase/supabase-js';

// Kredensial Resmi Proyek Supabase Anda
const supabaseUrl = 'https://khlpzyyshtuwronalntr.supabase.co'; 
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtobHB6eXlzaHR1d3JvbmFsbnRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwNzY3NzQsImV4cCI6MjA5OTY1Mjc3NH0.pgxKvHCXl-ah4GbhMCbgNQ3dRNx-J1dWIwVNJNKVYCQ'; 

const cleanUrl = supabaseUrl.replace(/\/$/, "").replace(/\/rest\/v1$/, "");
const supabase = createClient(cleanUrl, supabaseAnonKey);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: "ID dokumen tidak ditemukan dalam request URL" }), { status: 400 });
    }

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, data }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}