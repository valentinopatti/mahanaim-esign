import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getUserFromRequest, unauthorized, forbidden } from '../../../../lib/serverAuth';
import { computeRetractEligibility } from '../../../../lib/retract';
import { sendMail } from '../../../../lib/mailer';

export async function POST(request) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();

  const { documentId } = await request.json();

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

  const { canRetract } = computeRetractEligibility(me, recipients);
  if (!canRetract) {
    return new Response(JSON.stringify({ error: 'Tanda tangan ini tidak bisa dibatalkan lagi (lewat 15 menit, atau sudah ada pihak lain yang menandatangani).' }), { status: 403 });
  }

  await supabaseAdmin
    .from('documents')
    .update({ current_file_url: doc.original_file_url, status: 'sent' })
    .eq('id', documentId);

  await supabaseAdmin
    .from('document_recipients')
    .update({ status: 'viewed', signed_at: null })
    .eq('id', me.id);

  await supabaseAdmin.from('document_signatures').delete().eq('document_recipient_id', me.id);
  await supabaseAdmin.from('document_required_pages').update({ fulfilled: false }).eq('document_recipient_id', me.id);
  await supabaseAdmin.from('document_events').insert([{ document_id: documentId, recipient_id: me.id, event_type: 'retracted' }]);

  // Sequential: undo any next-tier unlock that only happened because of this now-undone signature.
  if (doc.signing_mode === 'sequential') {
    const toRelock = recipients.filter((r) => r.role === 'signer' && r.id !== me.id && r.order_index > me.order_index && r.status !== 'signed');
    if (toRelock.length) {
      await supabaseAdmin
        .from('document_recipients')
        .update({ status: 'waiting', notified_at: null })
        .in('id', toRelock.map((r) => r.id));
    }
  }

  const owner = await supabaseAdmin.from('profiles').select('full_name, email').eq('id', doc.owner_id).single();
  await sendMail({
    to: owner.data.email,
    subject: `${me.profiles.full_name} membatalkan tanda tangan pada "${doc.file_name}"`,
    html: `<p>${me.profiles.full_name} membatalkan tanda tangannya pada dokumen <b>${doc.file_name}</b>.</p>`,
  });

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
