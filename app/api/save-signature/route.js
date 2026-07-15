import { createClient } from '@supabase/supabase-js';
import { PDFDocument, degrees } from 'pdf-lib';
import { Resend } from 'resend';

// Membaca dari Environment Variable
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co'; 
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; 
const resend = new Resend(process.env.RESEND_API_KEY); 

const cleanUrl = supabaseUrl.replace(/\/$/, "").replace(/\/rest\/v1$/, "");
const supabase = createClient(cleanUrl, supabaseAnonKey);

export async function POST(request) {
  try {
    // Ambil parameter dari frontend
    const { documentId, signatureImage, coordinateX, coordinateY, pageNumber, containerWidth, containerHeight } = await request.json();

    // 1. Ambil data dokumen dari Supabase
    const { data: docData, error: fetchError } = await supabase
      .from('documents')
      .select('file_name, signer_name, signer_email, file_url')
      .eq('id', documentId)
      .single();

    if (fetchError || !docData) {
      return new Response(JSON.stringify({ error: "Dokumen tidak ditemukan di database" }), { status: 404 });
    }

    // 2. Load berkas PDF ke memory mesin pdf-lib
    const pdfBase64Raw = docData.file_url.split(';base64,')[1] || docData.file_url;
    const pdfDoc = await PDFDocument.load(Buffer.from(pdfBase64Raw, 'base64'));

    const pages = pdfDoc.getPages();
    const targetPage = pages[pageNumber - 1];
    
    // Dapatkan dimensi asli kertas PDF (Absolut)
    const { width: pageWidth, height: pageHeight } = targetPage.getSize();
    const pageRotation = targetPage.getRotation().angle; 

    // 3. Konversi gambar tanda tangan dan dapatkan ukuran aslinya
    const sigImageRaw = signatureImage.split(';base64,')[1] || signatureImage;
    const embeddedImage = await pdfDoc.embedPng(Buffer.from(sigImageRaw, 'base64'));

    // --- FITUR ANTI-SKEW (MEMPERTAHANKAN RASIO ASLI) ---
    // Dapatkan lebar dan tinggi asli dari coretan gambar tanda tangan
    const originalWidth = embeddedImage.width;
    const originalHeight = embeddedImage.height;

    // Tentukan lebar tanda tangan yang diinginkan di dokumen PDF (misalnya lebar tetap 85)
    const ttdWidth = 85; 
    
    // Hitung tinggi secara proporsional agar bentuk tanda tangan TIDAK GEPENG/SKEW
    const aspectRatio = originalHeight / originalWidth;
    const ttdHeight = ttdWidth * aspectRatio;
    // ----------------------------------------------------

    // 4. Hitung Faktor Skala berdasarkan layar pratinjau dokumen
    const scaleX = containerWidth ? (pageWidth / containerWidth) : 1;
    const scaleY = containerHeight ? (pageHeight / containerHeight) : 1;

    // Hitung posisi koordinat murni
    let calculatedX = coordinateX * scaleX;
    let calculatedY = pageHeight - (coordinateY * scaleY) - ttdHeight;

    let finalX = calculatedX;
    let finalY = calculatedY;
    let finalRotation = 0;

    // Menyesuaikan posisi jika dokumen memiliki properti rotasi dari scanner
    if (pageRotation === 90) {
      finalX = calculatedY;
      finalY = calculatedX;
      finalRotation = -90;
    } else if (pageRotation === 180) {
      finalX = pageWidth - calculatedX - ttdWidth;
      finalY = calculatedY;
      finalRotation = 180;
    } else if (pageRotation === 270) {
      finalX = pageHeight - calculatedY - ttdHeight;
      finalY = pageWidth - calculatedX - ttdWidth;
      finalRotation = 90;
    }

    // Jaga agar tidak melebihi batas tepi halaman PDF
    if (finalX < 0) finalX = 0;
    if (finalY < 0) finalY = 0;
    if (finalX + ttdWidth > pageWidth) finalX = pageWidth - ttdWidth;
    if (finalY + ttdHeight > pageHeight) finalY = pageHeight - ttdHeight;

    // 5. Cetak gambar tanda tangan secara permanen dengan rasio yang benar
    targetPage.drawImage(embeddedImage, {
      x: finalX,
      y: finalY, 
      width: ttdWidth,
      height: ttdHeight, // Menggunakan tinggi proporsional otomatis (Bebas skew!)
      rotate: degrees(finalRotation),
    });

    // 6. Simpan hasil PDF baru
    const modifiedPdfBytes = await pdfDoc.save();
    const modifiedPdfBase64 = `data:application/pdf;base64,${Buffer.from(modifiedPdfBytes).toString('base64')}`;

    // 7. Perbarui data ke Supabase
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

    // 8. Kirim notifikasi email otomatis
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