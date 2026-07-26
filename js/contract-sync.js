/* ════════════════════════════════════════════════════════════════
   contract-sync.js
   Keeps a contract doc's summary fields in sync with its child
   treatments/payments. Shared by Contracts today, and by
   Treatments/Payments once those modules exist — a status flip on
   either child collection should call recalcContractRollup() so the
   contract's numbers never drift from what actually happened.

   Two tiers, matching how a "line update" can affect a contract:
     - Status-only changes (payment received, treatment completed,
       either un-done) -> recalcContractRollup() alone. Silent,
       no change to what the contract is worth.
     - Structural changes (a session cancelled outright, or a new
       session added) -> amendContractScope() first, which adjusts
       totalAmount/noOfSessions and writes an audit log entry, then
       calls recalcContractRollup() itself. These should be gated by
       a confirmation in the UI — this module doesn't decide that,
       it just does the write once the caller has confirmed.
   ════════════════════════════════════════════════════════════════ */

import { db } from '../firebase-config.js';
import {
  doc, getDoc, updateDoc, collection, addDoc, getDocs, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { patchCachedDoc } from './firestore-cache.js';

/** Recompute completedSessions/totalSessions/nextTreatmentDate/totalPaid/
 *  balanceRemaining/lastPaymentDate for one contract, from its current
 *  treatments + payments, and write them onto the contract doc.
 *  Cancelled lines are excluded from every count — they no longer count
 *  toward the contract's scope. */
export async function recalcContractRollup(contractId) {
  const contractRef = doc(db, 'contracts', contractId);
  const [contractSnap, treatSnap, paySnap] = await Promise.all([
    getDoc(contractRef),
    getDocs(query(collection(db, 'treatments'), where('contractId', '==', contractId))),
    getDocs(query(collection(db, 'payments'), where('contractId', '==', contractId)))
  ]);
  if (!contractSnap.exists()) return null;
  const contract = contractSnap.data();

  const treatments = treatSnap.docs.map(d => d.data()).filter(t => t.status !== 'Cancelled');
  const payments = paySnap.docs.map(d => d.data()).filter(p => p.status !== 'Cancelled');

  const totalSessions = treatments.length;
  const completedSessions = treatments.filter(t => t.status === 'Completed').length;
  const nextTreatmentDate = treatments
    .filter(t => t.status !== 'Completed' && t.treatmentDate)
    .map(t => t.treatmentDate)
    .sort()[0] || null;

  const totalPaid = payments
    .filter(p => p.status === 'Received')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const lastPaymentDate = payments
    .filter(p => p.status === 'Received' && p.paymentDate)
    .map(p => p.paymentDate)
    .sort()
    .slice(-1)[0] || null;
  const balanceRemaining = Number(contract.totalAmount || 0) - totalPaid;

  const rollup = {
    totalSessions, completedSessions, nextTreatmentDate,
    totalPaid, balanceRemaining, lastPaymentDate
  };

  await updateDoc(contractRef, rollup);
  patchCachedDoc('contracts', contractId, rollup);
  return rollup;
}

/** Adjust a contract's committed total value + session count (e.g. a
 *  session was cancelled and its billed amount should no longer count,
 *  or an extra session was added and needs to be billed for), log it to
 *  the audit trail, then recalc the rollup on top.
 *  amountDelta/sessionDelta: negative to shrink, positive to grow. */
export async function amendContractScope(contractId, { amountDelta = 0, sessionDelta = 0, reason, performedBy = '', performedByUid = '' }) {
  const contractRef = doc(db, 'contracts', contractId);
  const snap = await getDoc(contractRef);
  if (!snap.exists()) throw new Error('Contract not found.');
  const c = snap.data();

  const newTotalAmount = Math.max(0, Number(c.totalAmount || 0) + amountDelta);
  const newNoOfSessions = Math.max(0, Number(c.noOfSessions || 0) + sessionDelta);

  await updateDoc(contractRef, {
    totalAmount: newTotalAmount,
    noOfSessions: newNoOfSessions,
    updatedAt: serverTimestamp()
  });

  await addDoc(collection(db, 'audit_log'), {
    action: amountDelta < 0 || sessionDelta < 0 ? 'contract_amend_decrease' : 'contract_amend_increase',
    entityType: 'contract',
    entityId: contractId,
    description: reason || `Contract total adjusted by ${amountDelta} (${sessionDelta >= 0 ? '+' : ''}${sessionDelta} session${Math.abs(sessionDelta) === 1 ? '' : 's'})`,
    performedBy, performedByUid,
    createdAt: serverTimestamp()
  });

  patchCachedDoc('contracts', contractId, { totalAmount: newTotalAmount, noOfSessions: newNoOfSessions });

  return recalcContractRollup(contractId);
}
