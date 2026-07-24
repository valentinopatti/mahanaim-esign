export const RETRACT_WINDOW_MS = 3 * 60 * 1000;

// Retract is only allowed while inside the time window AND no other signer has
// already signed (parallel or sequential) — undoing cleanly requires that this
// recipient's stamp is the only change layered on top of original_file_url.
export function computeRetractEligibility(myRecipient, recipients) {
  if (!myRecipient || myRecipient.role !== 'signer' || myRecipient.status !== 'signed' || !myRecipient.signed_at) {
    return { canRetract: false, retractDeadline: null };
  }
  const signedAtMs = new Date(myRecipient.signed_at).getTime();
  const retractDeadline = new Date(signedAtMs + RETRACT_WINDOW_MS).toISOString();
  const withinWindow = Date.now() - signedAtMs <= RETRACT_WINDOW_MS;
  const othersSigned = recipients.some((r) => r.role === 'signer' && r.status === 'signed' && r.id !== myRecipient.id);
  return { canRetract: withinWindow && !othersSigned, retractDeadline };
}
