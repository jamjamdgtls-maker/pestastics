/* ════════════════════════════════════════════════════════════════
   Shared treatment mutation logic.

   Treatments' own Complete/Reschedule/Cancel modals call these, and so
   does Overdue's — there is exactly one correct implementation of each
   operation, imported by whichever module's UI triggered it. Neither
   caller re-implements the actual Firestore writes; they just collect
   form input, call the matching function here, and update their own
   local state/UI from what it returns.

   Deliberately NOT responsible for: showing toasts, writing audit_log
   entries, or closing modals — those are UI concerns specific to
   whichever page is calling in, so each caller handles them itself
   after awaiting the call.
════════════════════════════════════════════════════════════════ */
import {
  collection, doc, getDocs, query, where, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { smartUpdateDoc } from './firestore-cache.js';
import { recalcContractRollup, amendContractScope } from './contract-sync.js';

function fmtDateShort(v) {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Marks a treatment completed and refreshes its contract's rollup.
 * `date` must already be a "YYYY-MM-DD" string, not a Date object.
 * Returns { update, rollup } — rollup is the fresh set of contract
 * rollup fields (or null if the treatment has no contractId), so the
 * caller can patch its own local contract cache without a second read.
 */
export async function completeTreatment(db, treatmentId, { date, technician, chemicalsUsed, notes, remarks, driveUrl, contractId }) {
  const update = {
    status: 'completed',
    treatmentDate: date,
    technician,
    chemicalsUsed: chemicalsUsed || '',
    notes: notes || '',
    remarks: remarks || '',
    ...(driveUrl ? { serviceReportUrl: driveUrl } : {}),
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await smartUpdateDoc(doc(db, 'treatments', treatmentId), update, ['treatments']);
  const rollup = contractId ? await recalcContractRollup(contractId) : null;
  return { update, rollup };
}

/**
 * Reschedules a treatment, appending a full entry to its
 * rescheduleHistory array (not just overwriting a single "original
 * date" field, so a treatment rescheduled more than once keeps every
 * prior move on record). `newDateStr` must be a "YYYY-MM-DD" string.
 */
export async function rescheduleTreatment(db, treatmentId, { currentTreatment, newDateStr, newTime, newTeam, reason, notes, performedBy }) {
  const historyEntry = {
    from: currentTreatment?.treatmentDate || null,
    fromFormatted: fmtDateShort(currentTreatment?.treatmentDate),
    to: newDateStr,
    toFormatted: fmtDateShort(newDateStr),
    reason,
    notes: notes || '',
    by: performedBy || '',
    at: new Date().toISOString()
  };
  const prevHistory = currentTreatment?.rescheduleHistory || [];
  const update = {
    status: 'rescheduled',
    treatmentDate: newDateStr,
    rescheduleReason: reason,
    rescheduleHistory: [...prevHistory, historyEntry],
    notes: notes || currentTreatment?.notes || '',
    rescheduledAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (newTime) update.treatmentTime = newTime;
  if (newTeam) update.assignedTeam = newTeam;

  await smartUpdateDoc(doc(db, 'treatments', treatmentId), update, ['treatments']);
  const rollup = currentTreatment?.contractId ? await recalcContractRollup(currentTreatment.contractId) : null;
  return { update, rollup, reschedCount: update.rescheduleHistory.length };
}

/**
 * Cancels a treatment — and, unlike a naive "just flip the status"
 * cancel, also cancels its paired payment (matched via contractId +
 * sessionNo) and shrinks the contract's committed totalAmount/
 * noOfSessions via amendContractScope(). Skipping this half is what
 * leaves a ghost payment the contract still expects, for a session
 * that no longer exists — the original standalone Overdue page did
 * exactly that.
 * Returns { update, rollup, linkWarning } — linkWarning is true if the
 * treatment cancelled fine but the payment/contract adjustment failed,
 * so the caller can surface a "cancelled, but check the total" notice
 * instead of a silent success.
 */
export async function cancelTreatment(db, treatmentId, { currentTreatment, reason, notes, performedBy, performedByUid }) {
  const update = {
    status: 'cancelled',
    cancellationReason: reason,
    notes: notes || '',
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await smartUpdateDoc(doc(db, 'treatments', treatmentId), update, ['treatments']);

  let rollup = null, linkWarning = false;
  if (currentTreatment?.contractId && currentTreatment?.sessionNo) {
    try {
      const paySnap = await getDocs(query(collection(db, 'payments'), where('contractId', '==', currentTreatment.contractId), where('sessionNo', '==', currentTreatment.sessionNo)));
      const cancelledAmount = paySnap.docs.reduce((sum, d) => sum + Number(d.data().amount || 0), 0);
      if (!paySnap.empty) {
        const payBatch = writeBatch(db);
        paySnap.docs.forEach(d => payBatch.update(d.ref, { status: 'Cancelled' }));
        await payBatch.commit();
      }
      rollup = await amendContractScope(currentTreatment.contractId, {
        amountDelta: -cancelledAmount, sessionDelta: -1,
        reason: `Cancelled treatment ${currentTreatment.treatmentNo || treatmentId} — ${reason}`,
        performedBy: performedBy || '', performedByUid: performedByUid || ''
      });
    } catch (linkErr) {
      console.warn('Could not adjust the linked payment/contract total:', linkErr);
      linkWarning = true;
    }
  } else if (currentTreatment?.contractId) {
    // No sessionNo on this treatment (a legacy record predating this
    // link) — still refresh completedSessions/nextTreatmentDate, just
    // without touching totalAmount since there's no payment to pair it with.
    rollup = await recalcContractRollup(currentTreatment.contractId);
  }
  return { update, rollup, linkWarning };
}
