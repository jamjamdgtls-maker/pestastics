/* ════════════════════════════════════════════════════════════════
   Shared payment mutation logic. Payments' own edit form and
   Overdue's quick-update form both call this — one correct
   implementation, imported by whichever page's UI triggered it.
════════════════════════════════════════════════════════════════ */
import { doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { smartUpdateDoc } from './firestore-cache.js';
import { recalcContractRollup } from './contract-sync.js';

/**
 * Updates a payment doc with whatever partial field set the caller
 * passes in `fields` (Payments' own form sends the full record;
 * Overdue's quick-update form sends only status/mode/OR number/date/
 * remarks), then refreshes its contract's rollup — every caller needs
 * this and it's easy to silently skip, which is exactly what the
 * original standalone Overdue page did.
 * `fields.dueDate`/`fields.paymentDate`, if present, must already be
 * "YYYY-MM-DD" strings, not Date objects.
 * Returns { update, rollup }.
 */
export async function updatePayment(db, paymentId, fields, contractId) {
  const update = { ...fields, updatedAt: serverTimestamp() };
  await smartUpdateDoc(doc(db, 'payments', paymentId), update, ['payments']);
  const rollup = contractId ? await recalcContractRollup(contractId) : null;
  return { update, rollup };
}
