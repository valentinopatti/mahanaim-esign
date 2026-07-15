import { createClient } from '@supabase/supabase-js';
import { PDFDocument, degrees } from 'pdf-lib';
import { Resend } from 'resend';

// Membaca dari Environment Variable (Aman dari robot pemindai GitHub)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co'; 
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; 
const resend = new Resend(process.env.RESEND_API_KEY); 

const cleanUrl = supabaseUrl.replace(/\/$/, "").replace(/\/rest\/v1$/, "");
const supabase = createClient(cleanUrl, supabaseAnonKey);

export async function POST(request) {
  try {
    // Ambil parameter koordinat dari halaman depan
    const { documentId, signatureImage, coordinateX, coordinateY, pageNumber } = await request.json();

    // 1. Ambil data dokumen dari Supabase
    const { data: docData, error: fetchError } = await supabase
      .from('documents')
      .select('file_name, signer_name, signer_email, file_url')
      .eq('id', documentId)
      .single();

    if (fetchError || !docData) {
      return new Response(JSON.stringify({ error: "Dokumen tidak ditemukan di database Mahanaim" }), { status: 404 });
    }

    // 2. Load berkas PDF asli ke dalam memory mesin pdf-lib
    const pdfBase64Raw = docData.file_url.split(';base64,')[1] || docData.file_url;
    const pdfDoc = await PDFDocument.load(Buffer.from(pdfBase64Raw, 'base64'));

    const pages = pdfDoc.getPages();
    const targetPage = pages[pageNumber - 1];
    
    // Dapatkan dimensi asli kertas PDF
    const { width: pageWidth, height: pageHeight } = targetPage.getSize();
    
    // Deteksi rotasi bawaan dokumen (jika discan miring oleh mesin printer/scanner)
    const pageRotation = targetPage.getRotation().angle; 

    // 3. Konversi coretan tanda tangan menjadi objek gambar PDF
    const sigImageRaw = signatureImage.split(';base64,')[1] || signatureImage;
    const embeddedImage = await pdfDoc.embedPng(Buffer.from(sigImageRaw, 'base64'));

    // Ukuran dimensi tanda tangan yang akan dicetak pada kertas PDF
    const ttdWidth = 75; 
    const ttdHeight = 37.5;

    // 4. Kalibrasi Akurat Sumbu Koordinat agar Posisi Pas & Presisi
    let finalX = coordinateX;
    let finalY = pageHeight - coordinateY - ttdHeight; // Rumus presisi pembalik sumbu Y (atas layar ke bawah PDF)
    let finalRotation = 0;

    // Menyesuaikan posisi koordinat jika file PDF asli memiliki metadata rotasi terbalik
    if (pageRotation === 90) {
      finalX = coordinateY;
      finalY = coordinateX;
      finalRotation = -90;
    } else if (pageRotation === 180) {
      finalX = pageWidth - coordinateX - ttdWidth;
      finalY = coordinateY;
      finalRotation = 180;
    } else if (pageRotation === 270) {
      finalX = pageHeight - coordinateY - ttdHeight;
      finalY = pageWidth - coordinateX - ttdWidth;
      finalRotation = 90;
    }

    // 5. Gambar/Cetak tanda tangan fisik ke atas dokumen PDF
    targetPage.drawImage(embeddedImage, {
      x: finalX,
      y: finalY, 
      width: ttdWidth,
      height: ttdHeight,
      rotate: degrees(finalRotation), // Mengunci tanda tangan agar selalu tegak lurus
    });

    // 6. Simpan dokumen PDF yang baru yang telah ditandatangani
    const modifiedPdfBytes = await pdfDoc.save();
    const modifiedPdfBase64 = `data:application/pdf;base64,${Buffer.from(modifiedPdfBytes).toString('base64')}`;

    // 7. Update status dokumen menjadi SIGNED di database Supabase
    const { error: updateError } = await supabase
      .from('documents')
      .update({ 
        file_url: modifiedPdfBase64,
        status: 'SIGNED' 
      })
      .eq('id', documentId);

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
    }

    // 8. Kirim notifikasi email otomatis beserta file PDF lampiran akhir melalui Resend
    try {
      const pdfBuffer = Buffer.from(modifiedPdfBytes);

      await resend.emails.send({
        from: 'Mahanaim E-Sign <onboarding@resend.dev>',
        to: 'valentino.mahanaim@gmail.com',
        subject: `🎉 Dokumen Selesai Ditandatangani: ${docData.file_name}`,
        html: `
          <div style="font-family: sans-serif; color: #333; max-width: 600px; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #16a34a;">Notifikasi Dokumen Mahanaim</h2>
            <p>Halo Pak Valentino,</p>
            <p>Dokumen Anda telah berhasil ditandatangani secara resmi.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; width: 150px;">Nama Berkas:</td>
                <td style="padding: 8px 0;">${docData.file_name}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Penandatangan:</td>
                <td style="padding: 8px 0;">${docData.signer_name} (${docData.signer_email})</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                <td style="padding: 8px 0; color: #16a34a; font-weight: bold;">SIGNED (SELESAI)</td>
              </tr>
            </table>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 13px; color: #444; background-color: #f0fdf4; padding: 10px; border-left: 4px solid #16a34a;">
              ℹ️ <strong>Informasi Lampiran:</strong> Berkas PDF hasil akhir yang sudah dibubuhi tanda tangan fisik telah disematkan langsung di bagian bawah email ini.
            </p>
          </div>
        `,
        attachments: [
          {
            filename: docData.file_name || 'dokumen_ditandatangani.pdf',
            content: pdfBuffer,
          },
        ],
      });
    } catch (emailErr) {
      console.error("Gagal mengirim notifikasi email:", emailErr);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}