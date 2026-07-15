import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// 1. Inisialisasi Database Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, 
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);

// 2. Konfigurasi Server Email (SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true, // true untuk port 465, false untuk port 587
  auth: {
    user: process.env.SMTP_USER, 
    pass: process.env.SMTP_PASSWORD, 
  },
});

export async function POST(request) {
  try {
    const { docId, action, signerName, signerEmail, signatureData } = await request.json();

    // 3. Update status perjalanan dokumen di Supabase
    const updateData = { status: action };
    if (signatureData) {
      updateData.signature_data = signatureData;
    }

    const { data, error } = await supabase
      .from('documents')
      .update(updateData)
      .eq('id', docId)
      .select();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    // 4. Susun Notifikasi Email Otomatis untuk Pak Valentino
    let subject = `[Update] Dokumen ${action}`;
    let body = `Halo Pak Valentino,\n\nDokumen Anda saat ini berstatus: ${action} oleh ${signerName} (${signerEmail}).`;

    if (action === 'SIGNED') {
      subject = `[SUKSES] Dokumen Telah Ditandatangani!`;
      body = `Halo Pak Valentino,\n\nKabar baik! Dokumen Anda telah ditandatangani oleh ${signerName} (${signerEmail}). Silakan periksa dashboard Anda.`;
    }

    // 5. Jalankan Pengiriman Email
    await transporter.sendMail({
      from: `"Mahanaim E-Sign" <${process.env.SMTP_USER}>`,
      to: 'valentino.pattikawa@mahanaim.com', // Email utama Anda untuk menerima update
      subject: subject,
      text: body,
    });

    return new Response(JSON.stringify({ success: true, data }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}