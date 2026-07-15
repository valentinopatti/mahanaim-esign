import { createClient } from '@supabase/supabase-js';
import { PDFDocument, degrees } from 'pdf-lib'; // Menambahkan import degrees untuk rotasi
import { Resend } from 'resend';

// Membaca dari Environment Variable (Aman dari robot pemindai GitHub)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://khlpzyyshtuwronalntr.supabase.co'; 
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; 
const resend = new Resend(process.env.RESEND_API_KEY); 

const cleanUrl = supabaseUrl.replace(/\/$/, "").replace(/\/rest\/v1$/, "");
const supabase = createClient(cleanUrl, supabaseAnonKey);

export async function POST(request) {
  try {
    const { documentId, signatureImage, coordinateX, coordinateY, pageNumber } = await request.json();

    const { data: docData, error: fetchError } = await supabase
      .from('documents')
      .select('file_name, signer_name, signer_email, file_url')
      .eq('id', documentId)
      .single();

    if (fetchError || !docData) {
      return new Response(JSON.stringify({ error: "Dokumen tidak ditemukan di database Mahanaim" }), { status: 404 });
    }

    const pdfBase64Raw = docData.file_url.split(';base64,')[1] || docData.file_url;
    const pdfDoc = await PDFDocument.load(Buffer.from(pdfBase64Raw, 'base64'));

    const pages = pdfDoc.getPages();
    const targetPage = pages[pageNumber - 1];
    
    // 1. Dapatkan ukuran asli halaman PDF
    const { width: pageWidth, height: pageHeight } = targetPage.getSize();
    
    // 2. Deteksi apakah PDF asli memiliki properti rotasi internal (misal dari scanner)
    const pageRotation = targetPage.getRotation().angle; // Mengembalikan angka sudut 0, 90, 180, atau 270

    // 3. Konversi gambar tanda tangan biner
    const sigImageRaw = signatureImage.split(';base64,')[1] || signatureImage;
    const embeddedImage = await pdfDoc.embedPng(Buffer.from(sigImageRaw, 'base64'));

    // Tentukan ukuran tanda tangan yang proporsional
    const ttdWidth = 75; 
    const ttdHeight = 37.5;

    // 4. Kalkulasi penempatan koordinat & rotasi yang adaptif
    let finalX = coordinateX;
    let finalY = pageHeight - coordinateY - ttdHeight; // Default rumus pembalik sumbu Y (atas ke bawah)
    let finalRotation = 0;

    // Jika PDF asli terdeteksi terotasi secara internal oleh scanner
    if (pageRotation === 90) {
      // Jika dokumen diputar 90 derajat searah jarum jam:
      finalX = coordinateY;
      finalY = coordinateX;
      finalRotation = -90; // Putar balik tanda tangan agar sejajar dengan orientasi kertas
    } else if (pageRotation === 180) {
      finalX = pageWidth - coordinateX - ttdWidth;
      finalY = coordinateY;
      finalRotation = 180;
    } else if (pageRotation === 270) {
      finalX = pageHeight - coordinateY - ttdHeight;
      finalY = pageWidth - coordinateX - ttdWidth;
      finalRotation = 90;
    }

    // 5. Gambar tanda tangan secara presisi dengan rotasi yang sesuai
    targetPage.drawImage(embeddedImage, {
      x: finalX,
      y: finalY, 
      width: ttdWidth,
      height: ttdHeight,
      rotate: degrees(finalRotation), // Memastikan tanda tangan tegak lurus mengikuti mata pembaca
    });

    const modifiedPdfBytes = await pdfDoc.save();
    const modifiedPdfBase64 = `data:application/pdf;base64,${Buffer.from(modifiedPdfBytes).toString('base64')}`;

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
            <p>Dokumen Anda telah berhasil ditandatangani secara resmi oleh rekan kerja Anda.</p>
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