import { Resend } from 'resend';

// Lazy & optional: Resend's constructor throws if the key is empty, which would
// otherwise crash every route that imports this file whenever RESEND_API_KEY is unset.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendMail({ to, subject, html, attachments }) {
  if (!resend) {
    console.warn('RESEND_API_KEY belum diset — notifikasi email dilewati.', { to, subject });
    return;
  }
  try {
    await resend.emails.send({
      from: 'Mahanaim E-Sign <onboarding@resend.dev>',
      to,
      subject,
      html,
      ...(attachments ? { attachments } : {}),
    });
  } catch (err) {
    console.error('Gagal mengirim email:', err);
  }
}
