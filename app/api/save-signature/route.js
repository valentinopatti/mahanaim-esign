import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
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

    const sigImageRaw = signatureImage.split(';base64,')[1] || signatureImage;
    const embeddedImage = await pdfDoc.embedPng(Buffer.from(sigImageRaw, 'base64'));

    const pages = pdfDoc.getPages();
    const targetPage = pages[pageNumber - 1];
    
    const { height: pageHeight } = targetPage.getSize();
    
    const ttdWidth = 75; 
    const ttdHeight = 37.5;

    targetPage.drawImage(embeddedImage, {
      x: coordinateX,
      y: pageHeight - coordinateY - ttdHeight, 
      width: ttdWidth,
      height: ttdHeight,
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