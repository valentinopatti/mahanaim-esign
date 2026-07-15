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
    const { 
      documentId, 
      signatureImage, 
      coordinateX, 
      coordinateY, 
      pageNumber, 
      containerWidth, 
      containerHeight,
      percentX, 
      percentY 
    } = await request.json();

    // 1. Ambil data dokumen dari Supabase
    const { data: docData, error: fetchError } = await supabase
      .from('documents')
      .select('file_name, signer_name, signer_email, file_url')
      .eq('id', documentId)
      .single();

    if (fetchError || !docData) {
      return new Response(JSON.stringify({ error: "Dokumen tidak ditemukan di database" }), { status: 404 });
    }

    // 2. Load berkas PDF ke memory
    const pdfBase64Raw = docData.file_url.split(';base64,')[1] || docData.file_url;
    const pdfDoc = await PDFDocument.load(Buffer.from(pdfBase64Raw, 'base64'));

    const pages = pdfDoc.getPages();
    const targetPage = pages[pageNumber - 1];
    
    // Dapatkan dimensi asli kertas PDF
    const { width: pageWidth, height: pageHeight } = targetPage.getSize();
    const pageRotation = targetPage.getRotation().angle; 

    // 3. Konversi gambar tanda tangan
    const sigImageRaw = signatureImage.split(';base64,')[1] || signatureImage;
    const embeddedImage = await pdfDoc.embedPng(Buffer.from(sigImageRaw, 'base64'));

    // --- UKURAN TANDA TANGAN IDEAL & PROPORSIONAL (ANTI RAKSASA) ---
    // Mengunci lebar tanda tangan sebesar 12% dari lebar kertas PDF agar pas untuk kolom kecil
    const ttdWidth = pageWidth * 0.12; 
    const aspectRatio = embeddedImage.height / embeddedImage.width;
    const ttdHeight = ttdWidth * aspectRatio;

    // 4. KALKULASI ABSOLUT BERBASIS PERSENTASE
    let finalX = 0;
    let finalY = 0;

    // Jika frontend mengirimkan hitungan persentase murni
    if (percentX !== undefined && percentY !== undefined) {
      finalX = (percentX / 100) * pageWidth;
      finalY = pageHeight - ((percentY / 100) * pageHeight) - ttdHeight;
    } 
    // Jika frontend mengirim koordinat pixel konvensional
    else if (containerWidth && containerHeight) {
      const calcPercentX = (coordinateX / containerWidth);
      const calcPercentY = (coordinateY / containerHeight);
      
      finalX = calcPercentX * pageWidth;
      finalY = pageHeight - (calcPercentY * pageHeight) - ttdHeight;
    } 
    // Fallback darurat
    else {
      finalX = coordinateX;
      finalY = pageHeight - coordinateY - ttdHeight;
    }

    let finalRotation = 0;

    // Koreksi rotasi otomatis dari pemindai kertas
    if (pageRotation === 90) {
      const temp = finalX;
      finalX = finalY;
      finalY = temp;
      finalRotation = -90;
    } else if (pageRotation === 180) {
      finalX = pageWidth - finalX - ttdWidth;
      finalRotation = 180;
    } else if (pageRotation === 270) {
      finalX = pageHeight - finalY - ttdHeight;
      finalY = pageWidth - finalX - ttdWidth;
      finalRotation = 90;
    }

    // Batasi ketat koordinat agar tidak keluar kertas
    if (finalX < 5) finalX = 5;
    if (finalY < 5) finalY = 5;
    if (finalX + ttdWidth > pageWidth) finalX = pageWidth - ttdWidth - 5;
    if (finalY + ttdHeight > pageHeight) finalY = pageHeight - ttdHeight - 5;

    // 5. Cetak gambar tanda tangan secara permanen
    targetPage.drawImage(embeddedImage, {
      x: finalX,
      y: finalY, 
      width: ttdWidth,
      height: ttdHeight,
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

    // 8. Kirim notifikasi email via Resend
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
            <p style="font-size: 13px; color: #444; background-color: #f0fdf4; padding: 10px; border-left: 4px solid #16a34a;">
              ℹ️ Berkas PDF hasil akhir yang sudah dibubuhi tanda tangan fisik telah disematkan langsung di bagian bawah email ini.
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