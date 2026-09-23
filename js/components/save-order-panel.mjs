import React, { useEffect, useRef, useState } from "react";
import { collection, doc } from "firebase/firestore";
import { buildReorderPlan, buildSavedOrder } from "../domain/saved-orders.mjs";
import { auth, db } from "../services/firebase.mjs";
import { savePendingOrder } from "../services/order-service.mjs";
import { userButtonStyle } from "../ui/styles.mjs";

const h = React.createElement;
const orderMoney = (value) => Number.isFinite(value) ? `$${value.toFixed(2)}` : "Not recorded";

export function SaveOrderPanel({ draft, user, profile, cigars, packOptions, requirePermission, onContinue, onStartNew }) {
  const storageKey = `haze-gray-cigars.pending-order-save.v1.${user.uid}`;
  const [attempt, setAttempt] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem(storageKey)); return value?.uid === user.uid && typeof value.id === "string" && value.payload ? value : null; } catch { return null; }
  });
  const attemptRef = useRef(attempt);
  const busy = useRef(false);
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const permitted = () => auth.currentUser?.uid === user.uid && requirePermission("canUseFinalReview");
  const save = async (useCurrentDraft = false) => {
    if (busy.current || saved || !permitted()) return;
    busy.current = true; setSaving(true); setMessage("");
    try {
      let pending = attemptRef.current;
      if (!pending) {
        pending = { uid: user.uid, id: doc(collection(db, "orders")).id, payload: buildSavedOrder(draft, user, profile) };
        // Persist before any network write so reloads and uncertain retries keep the same ID/payload.
        localStorage.setItem(storageKey, JSON.stringify(pending));
        attemptRef.current = pending; setAttempt(pending);
      }
      if (useCurrentDraft) {
        pending = { ...pending, payload: buildSavedOrder(draft, user, profile) };
        localStorage.setItem(storageKey, JSON.stringify(pending));
        attemptRef.current = pending; setAttempt(pending);
      }
      await savePendingOrder(pending, user.uid, permitted, cigars, packOptions);
      if (mounted.current && permitted()) { setSaved(true); setMessage("This order has been recorded in Order History. Your active draft has not been cleared."); }
    } catch (error) {
      if (mounted.current && permitted()) {
        setMessage(`Save could not be confirmed: ${error.message} Retry checks the same order ID. Your draft is unchanged.`);
      }
    } finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  let priceCheck = null;
  try { priceCheck = buildReorderPlan(attempt?.payload || buildSavedOrder(draft, user, profile), cigars, packOptions, []); } catch { /* Save reports invalid draft details. */ }
  const priceChanges = priceCheck?.available.filter((item) => item.historicalPrice !== item.line.unitPrice) || [];
  const finish = (startNew) => {
    if (!permitted()) return;
    try { localStorage.removeItem(storageKey); } catch (error) { setMessage("Could not clear the save receipt. Retry before starting another save."); return; }
    attemptRef.current = null; setAttempt(null); setSaved(false);
    if (startNew) onStartNew(); else onContinue();
  };

  return h("div", { style: { border: "1px solid #3B2A1E", borderRadius: 8, padding: 16, marginBottom: 20 } },
    h("div", { style: { fontFamily: "'Oswald', sans-serif", color: "#8A93A0", fontSize: 13, marginBottom: 10 } }, "Save an internal reference record using the captured draft prices. Prices and totals are not independently server-verified. This does not send email, submit, fulfill, or collect payment."),
    !saved && h("p", { style: { color: "#B8894C", fontSize: 13 } }, "Before saving, review draft prices against the current catalog. Saving preserves the captured prices; a reorder uses current prices. Unavailable configurations cannot be saved as a new record."),
    attempt && !saved && h("p", { style: { color: "#B8894C", fontSize: 13 } }, "Pending save ", attempt.id, ": ", attempt.payload.retailerName || "Retailer not recorded", " · ", orderMoney(attempt.payload.totals?.wholesaleTotal), ". Retry uses that captured order, even if you have since edited the draft."),
    !saved && h("button", { className: "hg-btn", onClick: () => save(), disabled: saving || (!attempt && !draft.orderItems.length), style: userButtonStyle }, saving ? "Saving…" : attempt ? "Check / Retry Saved Order" : "Save to Order History"),
    !saved && priceChanges.length > 0 && h("p", { style: { color: "#B8894C", fontSize: 13 } }, "Current catalog differs: ", priceChanges.map((item) => item.line.cigarName + " / " + item.line.vitola + " / " + item.line.packLabel + ": captured " + orderMoney(item.historicalPrice) + ", current " + orderMoney(item.line.unitPrice)).join("; "), ". Save records the captured prices shown above."),
    attempt && !saved && h("div", { style: { marginTop: 10 } },
      h("button", { className: "hg-btn", style: userButtonStyle, disabled: saving || !draft.orderItems.length, onClick: () => save(true) }, "Retry This ID With Current Draft"),
      h("p", { style: { color: "#8A93A0", fontSize: 12 } }, "Use this only to replace a rejected captured attempt. Any record already saved under this ID remains unchanged.")
    ),
    message && h("p", { role: "status", style: { color: saved ? "#B8894C" : "#d98a7c", fontSize: 13 } }, message),
    saved && h("div", { style: { display: "flex", flexWrap: "wrap", gap: 10 } },
      h("button", { className: "hg-btn", onClick: () => finish(false), style: userButtonStyle }, "Continue Editing Current Order"),
      h("button", { className: "hg-btn", onClick: () => finish(true), style: userButtonStyle }, "Start New Order (clear current draft)")
    )
  );
}
