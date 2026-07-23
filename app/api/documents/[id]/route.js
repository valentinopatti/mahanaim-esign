import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { getUserFromRequest, unauthorized, forbidden } from '../../../../lib/serverAuth';

export async function GET(request, { params }) {
  const auth = await getUserFromRequest(request);
  if (!auth) return unauthorized();
  const { id } = await params;

  const { data: doc, error: docError } = await supabaseAdmin
    .from('documents')
    .select('*, profiles!documents_owner_id_fkey(full_name, email)')
    .eq('id', id)
    .single();
  if (docError || !doc) return new Response(JSON.stringify({ error: 'Dokumen tidak ditemukan.' }), { status: 404 });

  const { data: recipients, error: recipientsError } = await supabaseAdmin
    .from('document_recipients')
    .select('*, profiles(full_name, email)')
    .eq('document_id', id)
    .order('order_index', { ascending: true });
  if (recipientsError) return new Response(JSON.stringify({ error: recipientsError.message }), { status: 500 });

  const isOwner = doc.owner_id === auth.user.id;
  const myRecipient = recipients.find((r) => r.user_id === auth.user.id) || null;

  if (!isOwner && !myRecipient) return forbidden('Anda tidak memiliki akses ke dokumen ini.');

  if (myRecipient && myRecipient.status !== 'signed') {
    await supabaseAdmin
      .from('document_recipients')
      .update({ status: myRecipient.status === 'notified' ? 'viewed' : myRecipient.status })
      .eq('id', myRecipient.id)
      .eq('status', 'notified');
  }

  const blockingSigner = myRecipient && myRecipient.role === 'signer' && myRecipient.status === 'waiting'
    ? recipients.find((r) => r.role === 'signer' && r.order_index < myRecipient.order_index && r.status !== 'signed')
    : null;

  return new Response(JSON.stringify({
    document: doc,
    recipients,
    isOwner,
    myRecipient,
    blockingSigner: blockingSigner ? { full_name: blockingSigner.profiles.full_name } : null,
  }), { status: 200 });
}
