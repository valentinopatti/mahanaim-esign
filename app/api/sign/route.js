import { PDFDocument, degrees } from 'pdf-lib';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getUserFromRequest, unauthorized, forbidden } from '../../../lib/serverAuth';
import { sendMail } from '../../../lib/mailer';

function appBaseUrl(request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

export async function POST(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();

  const { documentId, signatureImage, placements } = await request.json();

  if (!Array.isArray(placements) || placements.length === 0) {
    return new Response(JSON.stringify({ error: 'Tempatkan minimal 1 tanda tangan sebelum mengirim.' }), { status: 400 });
  }

  const { data: doc, error: docError } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', documentId)
    .single();
  if (docError || !doc) return new Response(JSON.stringify({ error: 'Dokumen tidak ditemukan.' }), { status: 404 });

  const { data: recipients, error: recipientsError } = await supabaseAdmin
    .from('document_recipients')
    .select('*, profiles(full_name, email)')
    .eq('document_id', documentId)
    .order('order_index', { ascending: true });
  if (recipientsError) return new Response(JSON.stringify({ error: recipientsError.message }), { status: 500 });

  const me = recipients.find((r) => r.user_id === auth.user.id);
  if (!me) return forbidden('Anda bukan penerima dokumen ini.');
  if (me.role !== 'signer') return forbidden('Anda hanya memiliki akses lihat pada dokumen ini.');
  if (me.status === 'signed') return new Response(JSON.stringify({ error: 'Anda sudah menandatangani dokumen ini.' }), { status: 400 });
  if (me.status === 'waiting') return forbidden('Belum giliran Anda untuk menandatangani.');

  // --- Cetak tanda tangan ke PDF, satu per penempatan (persentase terhadap ukuran halaman, zoom-invariant) ---
  const pdfBase64Raw = doc.current_file_url.split(';base64,')[1] || doc.current_file_url;
  const pdfDoc = await PDFDocument.load(Buffer.from(pdfBase64Raw, 'base64'));
  const pages = pdfDoc.getPages();

  const sigImageRaw = signatureImage.split(';base64,')[1] || signatureImage;
  const embeddedImage = await pdfDoc.embedPng(Buffer.from(sigImageRaw, 'base64'));
  const aspectRatio = embeddedImage.height / embeddedImage.width;

  for (const placement of placements) {
    const { pageNumber, percentX, percentY, percentWidth } = placement;
    const targetPage = pages[pageNumber - 1];
    if (!targetPage) continue;
    const { width: pageWidth, height: pageHeight } = targetPage.getSize();
    const pageRotation = targetPage.getRotation().angle;

    const clampedPercentWidth = Math.min(45, Math.max(5, Number(percentWidth) || 12));
    const ttdWidth = pageWidth * (clampedPercentWidth / 100);
    const ttdHeight = ttdWidth * aspectRatio;

    let finalX = (percentX / 100) * pageWidth;
    let finalY = pageHeight - ((percentY / 100) * pageHeight) - ttdHeight;
    let finalRotation = 0;

    if (pageRotation === 90) {
      const temp = finalX; finalX = finalY; finalY = temp; finalRotation = -90;
    } else if (pageRotation === 180) {
      finalX = pageWidth - finalX - ttdWidth; finalRotation = 180;
    } else if (pageRotation === 270) {
      finalX = pageHeight - finalY - ttdHeight; finalY = pageWidth - finalX - ttdWidth; finalRotation = 90;
    }

    if (finalX < 5) finalX = 5;
    if (finalY < 5) finalY = 5;
    if (finalX + ttdWidth > pageWidth) finalX = pageWidth - ttdWidth - 5;
    if (finalY + ttdHeight > pageHeight) finalY = pageHeight - ttdHeight - 5;

    targetPage.drawImage(embeddedImage, { x: finalX, y: finalY, width: ttdWidth, height: ttdHeight, rotate: degrees(finalRotation) });
  }

  const modifiedPdfBytes = await pdfDoc.save();
  const modifiedPdfBase64 = `data:application/pdf;base64,${Buffer.from(modifiedPdfBytes).toString('base64')}`;

  const { error: updateDocError } = await supabaseAdmin
    .from('documents')
    .update({ current_file_url: modifiedPdfBase64, status: 'in_progress' })
    .eq('id', documentId);
  if (updateDocError) return new Response(JSON.stringify({ error: updateDocError.message }), { status: 500 });

  await supabaseAdmin
    .from('document_recipients')
    .update({ status: 'signed', signed_at: new Date().toISOString() })
    .eq('id', me.id);

  await supabaseAdmin.from('document_signatures').insert(
    placements.map((p) => ({
      document_recipient_id: me.id,
      page_number: p.pageNumber,
      percent_x: p.percentX,
      percent_y: p.percentY,
      percent_width: p.percentWidth,
    }))
  );

  await supabaseAdmin.from('document_events').insert([{ document_id: documentId, recipient_id: me.id, event_type: 'signed' }]);

  const baseUrl = appBaseUrl(request);
  const owner = await supabaseAdmin.from('profiles').select('full_name, email').eq('id', doc.owner_id).single();

  await sendMail({
    to: owner.data.email,
    subject: `${me.profiles.full_name} telah menandatangani "${doc.file_name}"`,
    html: `<p>${me.profiles.full_name} baru saja menandatangani dokumen <b>${doc.file_name}</b>.</p>`,
  });

  const signers = recipients.map((r) => (r.id === me.id ? { ...r, status: 'signed' } : r)).filter((r) => r.role === 'signer');
  const remainingSigners = signers.filter((r) => r.status !== 'signed');

  if (remainingSigners.length === 0) {
    await supabaseAdmin.from('documents').update({ status: 'completed' }).eq('id', documentId);
    await supabaseAdmin.from('document_events').insert([{ document_id: documentId, event_type: 'completed' }]);

    const allRecipientEmails = [owner.data.email, ...recipients.map((r) => r.profiles.email)];
    const uniqueEmails = [...new Set(allRecipientEmails)];
    for (const email of uniqueEmails) {
      await sendMail({
        to: email,
        subject: `Dokumen "${doc.file_name}" telah selesai ditandatangani semua pihak`,
        html: `<p>Dokumen <b>${doc.file_name}</b> telah ditandatangani oleh seluruh pihak dan sudah final.</p>`,
        attachments: [{ filename: doc.file_name || 'dokumen.pdf', content: Buffer.from(modifiedPdfBytes) }],
      });
    }
  } else if (doc.signing_mode === 'sequential') {
    const nextOrder = Math.min(...remainingSigners.map((r) => r.order_index));
    const toUnlock = remainingSigners.filter((r) => r.order_index === nextOrder && r.status === 'waiting');
    if (toUnlock.length) {
      await supabaseAdmin
        .from('document_recipients')
        .update({ status: 'notified', notified_at: new Date().toISOString() })
        .in('id', toUnlock.map((r) => r.id));
      await supabaseAdmin.from('document_events').insert(
        toUnlock.map((r) => ({ document_id: documentId, recipient_id: r.id, event_type: 'unlocked' }))
      );
      for (const r of toUnlock) {
        await sendMail({
          to: r.profiles.email,
          subject: `Giliran Anda menandatangani "${doc.file_name}"`,
          html: `<p>Halo ${r.profiles.full_name}, sekarang giliran Anda menandatangani dokumen <b>${doc.file_name}</b>.</p><p><a href="${baseUrl}/sign/${documentId}">Buka dokumen</a></p>`,
        });
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
