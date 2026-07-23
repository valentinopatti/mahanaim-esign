import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getUserFromRequest, unauthorized } from '../../../lib/serverAuth';
import { sendMail } from '../../../lib/mailer';

function appBaseUrl(request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

export async function GET(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();

  const { data: owned, error: ownedError } = await supabaseAdmin
    .from('documents')
    .select('*, document_recipients(*, profiles(full_name, email))')
    .eq('owner_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (ownedError) return new Response(JSON.stringify({ error: ownedError.message }), { status: 500 });

  const { data: recipientRows, error: assignedError } = await supabaseAdmin
    .from('document_recipients')
    .select('*, documents(*)')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (assignedError) return new Response(JSON.stringify({ error: assignedError.message }), { status: 500 });

  return new Response(JSON.stringify({ owned, assigned: recipientRows }), { status: 200 });
}

export async function POST(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();

  const formData = await request.formData();
  const file = formData.get('file');
  const signingMode = formData.get('signing_mode') === 'sequential' ? 'sequential' : 'parallel';
  let recipients;
  let requiredPages;
  try {
    recipients = JSON.parse(formData.get('recipients') || '[]');
    requiredPages = JSON.parse(formData.get('required_pages') || '{}');
  } catch {
    return new Response(JSON.stringify({ error: 'Format penerima atau halaman wajib tidak valid.' }), { status: 400 });
  }

  if (!file) return new Response(JSON.stringify({ error: 'File PDF wajib diunggah.' }), { status: 400 });
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return new Response(JSON.stringify({ error: 'Minimal harus ada 1 penerima.' }), { status: 400 });
  }

  // Setiap penanda tangan wajib punya minimal 1 halaman yang ditentukan pengunggah.
  for (const r of recipients) {
    if (r.role !== 'signer') continue;
    const pages = requiredPages[r.user_id];
    if (!Array.isArray(pages) || pages.length === 0) {
      return new Response(JSON.stringify({ error: 'Tentukan minimal 1 halaman wajib TTD untuk setiap penanda tangan.' }), { status: 400 });
    }
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileBase64 = `data:application/pdf;base64,${bytes.toString('base64')}`;

  const { data: doc, error: docError } = await supabaseAdmin
    .from('documents')
    .insert([{
      owner_id: auth.user.id,
      file_name: file.name,
      original_file_url: fileBase64,
      current_file_url: fileBase64,
      signing_mode: signingMode,
      status: 'sent',
    }])
    .select()
    .single();
  if (docError) return new Response(JSON.stringify({ error: docError.message }), { status: 500 });

  const signerOrders = recipients.filter((r) => r.role === 'signer').map((r) => Number(r.order_index) || 1);
  const firstTierOrder = signerOrders.length ? Math.min(...signerOrders) : null;

  const rowsToInsert = recipients.map((r) => {
    const isSigner = r.role === 'signer';
    const orderIndex = isSigner ? Number(r.order_index) || 1 : 1;
    const isActive = !isSigner || signingMode === 'parallel' || orderIndex === firstTierOrder;
    return {
      document_id: doc.id,
      user_id: r.user_id,
      role: isSigner ? 'signer' : 'viewer',
      order_index: orderIndex,
      status: isActive ? 'notified' : 'waiting',
      notified_at: isActive ? new Date().toISOString() : null,
    };
  });

  const { data: insertedRecipients, error: recipientsError } = await supabaseAdmin
    .from('document_recipients')
    .insert(rowsToInsert)
    .select('*, profiles(full_name, email)');
  if (recipientsError) return new Response(JSON.stringify({ error: recipientsError.message }), { status: 500 });

  const requiredPageRows = insertedRecipients.flatMap((recipient) => {
    const original = recipients.find((r) => r.user_id === recipient.user_id);
    if (original?.role !== 'signer') return [];
    const pages = requiredPages[recipient.user_id] || [];
    return pages.map((pageNumber) => ({ document_recipient_id: recipient.id, page_number: Number(pageNumber) }));
  });
  if (requiredPageRows.length) {
    const { error: pagesError } = await supabaseAdmin.from('document_required_pages').insert(requiredPageRows);
    if (pagesError) return new Response(JSON.stringify({ error: pagesError.message }), { status: 500 });
  }

  const baseUrl = appBaseUrl(request);
  const events = [];
  for (const recipient of insertedRecipients) {
    if (recipient.status !== 'notified') continue;
    events.push({ document_id: doc.id, recipient_id: recipient.id, event_type: 'sent' });
    const roleLabel = recipient.role === 'signer' ? 'menandatangani' : 'meninjau';
    await sendMail({
      to: recipient.profiles.email,
      subject: `Dokumen "${doc.file_name}" menunggu Anda untuk ${roleLabel}`,
      html: `
        <div style="font-family: sans-serif; color: #333;">
          <p>Halo ${recipient.profiles.full_name},</p>
          <p><b>${auth.profile.full_name}</b> mengirimkan dokumen <b>${doc.file_name}</b> yang perlu Anda ${roleLabel}.</p>
          <p><a href="${baseUrl}/sign/${doc.id}">Buka dokumen</a></p>
        </div>
      `,
    });
  }
  if (events.length) await supabaseAdmin.from('document_events').insert(events);

  return new Response(JSON.stringify({ document: doc }), { status: 200 });
}
