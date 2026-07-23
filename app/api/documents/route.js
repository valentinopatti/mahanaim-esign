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
  try {
    recipients = JSON.parse(formData.get('recipients') || '[]');
  } catch {
    return new Response(JSON.stringify({ error: 'Format penerima tidak valid.' }), { status: 400 });
  }

  if (!file) return new Response(JSON.stringify({ error: 'File PDF wajib diunggah.' }), { status: 400 });
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return new Response(JSON.stringify({ error: 'Minimal harus ada 1 penerima.' }), { status: 400 });
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
