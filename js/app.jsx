import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Plus, X, ChevronRight, ArrowLeft, Pencil, Trash2, Search, Cigarette, Upload, Loader2, Scale, Mail, Copy, ShoppingCart, Minus } from "lucide-react";
import { doc, collection, onSnapshot } from "firebase/firestore";
import { parseMoney, getNumericPrice, getSinglePrice, computePackageMargins } from "./js/domain/pricing.mjs";
import { ROLE_LABELS, NO_PERMISSIONS, ROLE_PERMISSIONS, isValidRole, isActiveProfile, getProfilePermissions, getAssignableRoles, canManageAuthorizationProfile, authorizationUpdateError } from "./js/domain/authorization.mjs";
import { RETAILER_FIELDS, RETAILER_AUTOCOMPLETE, normalizeRetailerName, retailerLocation, normalizeRetailerSearch, retailerSearch, validRetailerId, formatRetailerPhone, validateRetailer, findDuplicateRetailer } from "./js/domain/retailers.mjs";
import { retailerAssignments, isAssignableRetailerUser, validateRepAssignments, assignedRepLabel, assignmentSummary, filterRetailerAssignments } from "./js/domain/assignments.mjs";
import { territoryDisplay, normalizeTerritory, retailerTerritoryLabel, retailerTerritoryFields, retailerTerritoryOptions, filterRetailerTerritories, territoryMismatches } from "./js/domain/territories.mjs";
import { nonnegativeMoney, isReadableSavedOrder, buildSavedOrder, buildReorderPlan, mergeReorderItems } from "./js/domain/saved-orders.mjs";
import { newSizeRow, SEED_CIGARS, EMPTY_FORM, PACK_OPTIONS } from "./js/domain/catalog-data.mjs";
import { db, auth } from "./js/services/firebase.mjs";
import { subscribeCatalog, isLegacyCatalogMigrationAvailable, saveCatalogRecord, deleteCatalogRecord, readLegacyCatalog } from "./js/services/catalog-service.mjs";
import { savePendingOrder, subscribeOrderHistory } from "./js/services/order-service.mjs";
import { saveRetailerAssignments, saveRetailerProfile, subscribeAssignmentProfiles, subscribeRetailerDirectory } from "./js/services/retailer-service.mjs";
import { saveAuthorizationProfile as saveAuthorizationProfileService, subscribeAuthorizedUsers } from "./js/services/profile-service.mjs";
import { signInWithEmail, signOutUser, subscribeAuthState } from "./js/services/auth-service.mjs";

// Application authorization only. Firestore Security Rules remain the enforcement boundary.
const userFieldStyle = { width: "100%", background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 };
const userButtonStyle = { background: "none", border: "1px solid #6E7681", color: "#C9CFD6", borderRadius: 4, padding: "8px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 13 };

function AuthorizationProfileEditor({ profile, currentUid, managerProfile, onSave, onClose }) {
  const [role, setRole] = useState(profile.role || "");
  const [territory, setTerritory] = useState(profile.territory || "");
  const [active, setActive] = useState(profile.active === true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setRole(profile.role || "");
    setTerritory(profile.territory || "");
    setActive(profile.active === true);
  }, [profile.role, profile.territory, profile.active]);
  const isSelf = profile.uid === currentUid;
  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const authorizationError = authorizationUpdateError(managerProfile, currentUid, profile.uid, profile, { role, active });
      if (authorizationError) throw new Error(authorizationError);
      await onSave(profile.uid, { role, territory, active });
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) setSaveError(e.message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <div style={{ marginTop: 20, border: "1px solid #B8894C", borderRadius: 8, padding: 20 }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginBottom: 8 }}>Edit Authorization Profile</div>
      <div style={{ color: "#C9CFD6", marginBottom: 16 }}>{profile.displayName || profile.email || profile.uid}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
        <label style={{ fontFamily: "'Oswald', sans-serif", color: "#8A93A0" }}>Role
          <select aria-label="Authorization role" value={getAssignableRoles(managerProfile).includes(role) ? role : ""} disabled={saving || isSelf} onChange={(e) => setRole(e.target.value)} style={userFieldStyle}>
            {!getAssignableRoles(managerProfile).includes(role) && <option value="">Select an allowed role</option>}
            {getAssignableRoles(managerProfile).map((value) => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}
          </select>
        </label>
        <label style={{ fontFamily: "'Oswald', sans-serif", color: "#8A93A0" }}>Territory
          <input value={territory} disabled={saving} onChange={(e) => setTerritory(e.target.value)} style={userFieldStyle} />
        </label>
        <label style={{ fontFamily: "'Oswald', sans-serif", color: "#8A93A0" }}>Status
          <select aria-label="Authorization status" value={active ? "active" : "disabled"} disabled={saving || isSelf} onChange={(e) => setActive(e.target.value === "active")} style={userFieldStyle}>
            <option value="active">Active</option><option value="disabled">Disabled</option>
          </select>
        </label>
      </div>
      {isSelf && <div style={{ color: "#8A93A0", fontSize: 12, marginTop: 12 }}>You cannot change your own role or disable your own profile.</div>}
      {saveError && <div role="alert" style={{ color: "#d98a7c", marginTop: 12 }}>{saveError}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button className="hg-btn" disabled={saving || !isValidRole(role)} onClick={save} style={{ ...userButtonStyle, background: "#B8894C", color: "#14161A" }}>{saving ? "Saving…" : "Save Profile"}</button>
        <button className="hg-btn" disabled={saving} onClick={onClose} style={userButtonStyle}>Cancel</button>
      </div>
    </div>
  );
}

function AuthorizedUsers({ currentUid, managerProfile, requirePermission, onSave, onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [ready, setReady] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [editingUid, setEditingUid] = useState(null);
  useEffect(() => {
    if (!requirePermission("canManageUsers")) return;
    let listening = true;
    const unsubscribe = subscribeAuthorizedUsers((profiles) => {
      if (!listening) return;
      setProfiles(profiles);
      setUsersError("");
      setReady(true);
    }, (e) => {
      if (!listening) return;
      setProfiles([]);
      setEditingUid(null);
      setUsersError("Could not load authorization profiles. (" + e.message + ")");
      setReady(true);
    });
    return () => { listening = false; unsubscribe(); };
  }, [currentUid, requirePermission]);
  const editingProfile = profiles.find((p) => p.uid === editingUid);
  useEffect(() => {
    if (editingUid && !canManageAuthorizationProfile(managerProfile, editingProfile)) {
      setEditingUid(null);
      setUsersError("You are no longer authorized to edit this authorization profile, or it no longer exists.");
    }
  }, [editingUid, editingProfile, managerProfile]);
  const openProfileEditor = (profile) => {
    if (!requirePermission("canManageUsers") || !canManageAuthorizationProfile(managerProfile, profile) ||
        (profile.role === "owner" && !requirePermission("canManageOwners"))) {
      setUsersError("You are not authorized to edit this authorization profile.");
      return;
    }
    setUsersError("");
    setEditingUid(profile.uid);
  };
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <button className="hg-btn" onClick={onClose} style={userButtonStyle}><ArrowLeft size={14} /> Back to list</button>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, marginTop: 20 }}>Authorized Users</div>
      <p style={{ color: "#8A93A0", fontSize: 13 }}>Manage existing Firestore authorization profiles. Changes take effect live. This screen does not create, disable, or modify Firebase Authentication accounts.</p>
      {usersError && <div role="alert" style={{ color: "#d98a7c", marginBottom: 16 }}>{usersError}</div>}
      {!ready ? <div style={{ color: "#8A93A0" }}>Loading authorization profiles…</div> : (
        <div className="hg-scroll" style={{ overflowX: "auto", border: "1px solid #3B2A1E", borderRadius: 8 }}>
          <table style={{ width: "100%", minWidth: 650, borderCollapse: "collapse", textAlign: "left", fontFamily: "'Oswald', sans-serif", fontSize: 13 }}>
            <thead style={{ background: "#1B1E22", color: "#B8894C" }}><tr>{["Name", "Email", "Role", "Territory", "Status", ""].map((label, i) => <th key={i} scope="col" style={{ padding: 12 }}>{label}</th>)}</tr></thead>
            <tbody>{profiles.map((profile) => (
              <tr key={profile.uid} style={{ borderTop: "1px solid #2c3036" }}>
                <td style={{ padding: 12 }}>{profile.displayName || "—"}{profile.uid === currentUid ? " (you)" : ""}</td>
                <td style={{ padding: 12 }}>{profile.email || "—"}</td>
                <td style={{ padding: 12 }}>{isValidRole(profile.role) ? ROLE_LABELS[profile.role] : "Unknown role"}</td>
                <td style={{ padding: 12 }}>{profile.territory || "—"}</td>
                <td style={{ padding: 12, color: profile.active === true ? "#B8894C" : "#d98a7c" }}>{profile.active === true ? "Active" : "Disabled"}</td>
                <td style={{ padding: 12 }}>{canManageAuthorizationProfile(managerProfile, profile) && <button className="hg-btn" onClick={() => openProfileEditor(profile)} style={userButtonStyle}>Edit</button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {!profiles.length && !usersError && <div style={{ padding: 16, color: "#8A93A0" }}>No authorization profiles found.</div>}
        </div>
      )}
      {canManageAuthorizationProfile(managerProfile, editingProfile) && <AuthorizationProfileEditor key={editingProfile.uid} profile={editingProfile} currentUid={currentUid} managerProfile={managerProfile} onSave={onSave} onClose={() => setEditingUid(null)} />}
    </div>
  );
}

function fileToCompressedDataUrl(file, maxDim = 480, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const LOGO_DATA_URL = "data:image/png;base64,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";


function getGaugePosition(value, cx = 60, cy = 62, r = 44) {
  const v = Math.min(5, Math.max(1, Number(value) || 1));
  const angle = Math.PI + ((v - 1) / 4) * Math.PI;
  return {
    value: v,
    x: cx + r * 0.78 * Math.cos(angle),
    y: cy + r * 0.78 * Math.sin(angle),
  };
}

function Gauge({ value, label }) {
  const cx = 60, cy = 62, r = 44;
  const { value: v, x: nx2, y: ny2 } = getGaugePosition(value, cx, cy, r);
  const ticks = [1, 2, 3, 4, 5].map((t) => {
    const ta = (-90 + ((t - 1) / 4) * 180 - 90) * Math.PI / 180;
    return {
      x1: cx + (r + 2) * Math.cos(ta), y1: cy + (r + 2) * Math.sin(ta),
      x2: cx + (r - 6) * Math.cos(ta), y2: cy + (r - 6) * Math.sin(ta), t,
    };
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg viewBox="0 0 120 72" width="120" height="72">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#454b53" strokeWidth="8" strokeLinecap="round" />
        {ticks.map((tk, i) => (
          <line key={i} x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} stroke="#B8894C" strokeWidth="2" />
        ))}
        <line x1={cx} y1={cy} x2={nx2} y2={ny2} stroke="#A8402E" strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill="#B8894C" stroke="#14161A" strokeWidth="1.5" />
      </svg>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#EDE6D6", letterSpacing: 1, marginTop: -14 }}>{v}/5</div>
      <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 3, color: "#8A93A0", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function Tag({ children, tone = "steel" }) {
  const tones = {
    steel: { bg: "rgba(110,118,129,0.18)", border: "#6E7681", color: "#C9CFD6" },
    brass: { bg: "rgba(184,137,76,0.16)", border: "#B8894C", color: "#E7C79A" },
  };
  const s = tones[tone];
  return (
    <span style={{
      display: "inline-block", padding: "5px 12px", margin: "0 6px 6px 0",
      fontFamily: "'Oswald', sans-serif", fontSize: 12.5, letterSpacing: 0.5,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color, borderRadius: 3,
    }}>{children}</span>
  );
}

const ORDER_DRAFT_STORAGE_KEY = "haze-gray-cigars.order-draft.v2.";
const orderDraftKey = (uid) => uid ? ORDER_DRAFT_STORAGE_KEY + uid : null;

function loadOrderDraft(uid) {
  if (!uid) return {};
  try {
    const draft = JSON.parse(localStorage.getItem(orderDraftKey(uid)));
    if (!draft || typeof draft !== "object") return {};
    const orderItems = Array.isArray(draft.orderItems)
      ? draft.orderItems.filter((item) =>
          item &&
          ["lineKey", "cigarId", "cigarName", "vitola", "dims", "packKey", "packLabel"]
            .every((key) => typeof item[key] === "string") &&
          Number.isFinite(item.unitPrice) &&
          Number.isInteger(item.qty) && item.qty > 0 &&
          (item.retailUnitValue === null || Number.isFinite(item.retailUnitValue))
        )
      : [];
    return {
      orderItems,
      retailerId: validRetailerId(draft.retailerId) ? draft.retailerId : "",
      orderRetailer: typeof draft.orderRetailer === "string" ? draft.orderRetailer : "",
      orderEmail: typeof draft.orderEmail === "string" ? draft.orderEmail : "",
      orderNotes: typeof draft.orderNotes === "string" ? draft.orderNotes : "",
    };
  } catch (e) {
    // Corrupt or unavailable storage must not prevent the app from loading.
    return {};
  }
}


const orderMoney = (value) => Number.isFinite(value) ? `$${value.toFixed(2)}` : "Not recorded";
const savedOrderDate = (value) => value?.toDate ? value.toDate().toLocaleString() : "Date unavailable";
function SaveOrderPanel({ draft, user, profile, cigars, packOptions, requirePermission, onContinue, onStartNew }) {
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
    } catch (e) {
      if (mounted.current && permitted()) {
        setMessage(`Save could not be confirmed: ${e.message} Retry checks the same order ID. Your draft is unchanged.`);
      }
    } finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  let priceCheck = null;
  try { priceCheck = buildReorderPlan(attempt?.payload || buildSavedOrder(draft, user, profile), cigars, packOptions, []); } catch { /* Save reports invalid draft details. */ }
  const priceChanges = priceCheck?.available.filter((item) => item.historicalPrice !== item.line.unitPrice) || [];
  const finish = (startNew) => {
    if (!permitted()) return;
    try { localStorage.removeItem(storageKey); } catch (e) { setMessage("Could not clear the save receipt. Retry before starting another save."); return; }
    attemptRef.current = null; setAttempt(null); setSaved(false);
    if (startNew) onStartNew(); else onContinue();
  };
  return <div style={{ border: "1px solid #3B2A1E", borderRadius: 8, padding: 16, marginBottom: 20 }}>
    <div style={{ fontFamily: "'Oswald', sans-serif", color: "#8A93A0", fontSize: 13, marginBottom: 10 }}>Save an internal reference record using the captured draft prices. Prices and totals are not independently server-verified. This does not send email, submit, fulfill, or collect payment.</div>
    {!saved && <p style={{ color: "#B8894C", fontSize: 13 }}>Before saving, review draft prices against the current catalog. Saving preserves the captured prices; a reorder uses current prices. Unavailable configurations cannot be saved as a new record.</p>}
    {attempt && !saved && <p style={{ color: "#B8894C", fontSize: 13 }}>Pending save {attempt.id}: {attempt.payload.retailerName || "Retailer not recorded"} · {orderMoney(attempt.payload.totals?.wholesaleTotal)}. Retry uses that captured order, even if you have since edited the draft.</p>}
    {!saved && <button className="hg-btn" onClick={() => save()} disabled={saving || (!attempt && !draft.orderItems.length)} style={userButtonStyle}>{saving ? "Saving…" : attempt ? "Check / Retry Saved Order" : "Save to Order History"}</button>}
    {!saved && priceChanges.length > 0 && <p style={{ color: "#B8894C", fontSize: 13 }}>Current catalog differs: {priceChanges.map((item) => item.line.cigarName + " / " + item.line.vitola + " / " + item.line.packLabel + ": captured " + orderMoney(item.historicalPrice) + ", current " + orderMoney(item.line.unitPrice)).join("; ")}. Save records the captured prices shown above.</p>}
    {attempt && !saved && <div style={{ marginTop: 10 }}><button className="hg-btn" style={userButtonStyle} disabled={saving || !draft.orderItems.length} onClick={() => save(true)}>Retry This ID With Current Draft</button><p style={{ color: "#8A93A0", fontSize: 12 }}>Use this only to replace a rejected captured attempt. Any record already saved under this ID remains unchanged.</p></div>}
    {message && <p role="status" style={{ color: saved ? "#B8894C" : "#d98a7c", fontSize: 13 }}>{message}</p>}
    {saved && <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <button className="hg-btn" onClick={() => finish(false)} style={userButtonStyle}>Continue Editing Current Order</button>
      <button className="hg-btn" onClick={() => finish(true)} style={userButtonStyle}>Start New Order (clear current draft)</button>
    </div>}
  </div>;
}

function OrderHistory({ user, profile, cigars, packOptions, draft, requirePermission, onApplyReorder, onClose, retailerFilter = null, onOpenRetailer }) {
  const [orders, setOrders] = useState([]);
  const [ready, setReady] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [review, setReview] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [retry, setRetry] = useState(0);
  const allOrders = getProfilePermissions(profile).canManageUsers;
  useEffect(() => {
    if (!requirePermission("canUseOrderBuilder")) return;
    let active = true;
    setOrders([]); setReady(false); setSelectedOrderId(null); setReview(false); setHistoryError("");
    const stop = subscribeOrderHistory({ allOrders, uid: user.uid }, (readable, malformedCount) => {
      if (!active) return;
      setOrders(readable);
      setHistoryError(malformedCount ? "Some saved records contain malformed data and cannot be displayed. The stored records have not been changed." : "");
      setReady(true);
    }, (e) => {
      if (!active) return;
      setOrders([]); setSelectedOrderId(null); setReview(false); setReady(true);
      setHistoryError(`Could not load order history: ${e.message}`);
    });
    return () => { active = false; stop(); };
  }, [user.uid, allOrders, retry, requirePermission]);
  const selected = orders.find((order) => order.id === selectedOrderId);
  const filtered = orders.filter((order) => (!retailerFilter || order.retailerId === retailerFilter) && (order.retailerNameNormalized || normalizeRetailerName(order.retailerName || "")).includes(normalizeRetailerName(search)));
  const plan = selected ? buildReorderPlan(selected, cigars, packOptions, draft.orderItems) : { available: [], unavailable: [] };
  const planSignature = JSON.stringify(plan);
  useEffect(() => { setAcknowledged(false); }, [planSignature]);
  const hasDraft = draft.orderItems.length > 0 || [draft.orderRetailer, draft.orderEmail, draft.orderNotes].some((value) => value.trim());
  const apply = (mode) => {
    if (!requirePermission("canUseOrderBuilder") || !selected) return;
    if (!plan.available.length || (plan.unavailable.length && !acknowledged)) { setHistoryError("Review and acknowledge unavailable items before continuing."); return; }
    try { onApplyReorder(selected, plan, mode); } catch (e) { setHistoryError(e.message); }
  };
  return <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
    <button className="hg-btn" style={userButtonStyle} onClick={selected ? () => { setSelectedOrderId(null); setReview(false); } : onClose}><ArrowLeft size={14} /> {selected ? "Back to History" : "Back to list"}</button>
    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, marginTop: 16 }}>Order History</div>
    {historyError && <div role="alert" style={{ color: "#d98a7c", margin: "12px 0" }}>{historyError} <button className="hg-btn" style={userButtonStyle} onClick={() => setRetry((value) => value + 1)}>Reload history</button></div>}
    {retailerFilter && <p>Showing exact retailer-linked orders you are permitted to read. Older unlinked orders are not included.</p>}
    {!selected ? <>
      <input aria-label="Search retailer history" placeholder="Search retailer name…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...userFieldStyle, margin: "12px 0" }} />
      {!ready ? <p>Loading saved orders…</p> : !orders.length ? <p>No saved orders yet.</p> : !filtered.length ? <p>No orders match this retailer search.</p> : <>
        <p style={{ color: "#8A93A0", fontSize: 13 }}>{filtered.length} saved orders · Most recent: {savedOrderDate(filtered[0].savedAt)}</p>
        {filtered.map((order) => <button key={order.id} className="hg-btn" onClick={() => { if (requirePermission("canUseOrderBuilder")) setSelectedOrderId(order.id); }} style={{ ...userButtonStyle, width: "100%", textAlign: "left", display: "block", marginBottom: 10, padding: 16 }}>
          <strong>{order.retailerName || "Retailer not recorded"}</strong> · {orderMoney(order.totals?.wholesaleTotal)}
          <div style={{ marginTop: 6, color: "#8A93A0" }}>{savedOrderDate(order.savedAt)} · {order.totals?.totalQuantity ?? "—"} total quantity · {order.lineItems?.length ?? "—"} lines{order.creatorDisplayName ? ` · ${order.creatorDisplayName}` : ""}</div>
        </button>)}
      </>}
    </> : <>
      <h2 style={{ fontFamily: "'Oswald', sans-serif" }}>{selected.retailerName || "Retailer not recorded"}</h2>
      {validRetailerId(selected.retailerId) && onOpenRetailer && <button className="hg-btn" style={userButtonStyle} onClick={() => onOpenRetailer(selected.retailerId)}>Open Retailer Profile</button>}
      <p>{savedOrderDate(selected.savedAt)}{selected.creatorDisplayName ? ` · ${selected.creatorDisplayName}` : ""}</p>
      <p style={{ color: "#8A93A0", overflowWrap: "anywhere" }}>Order {selected.id}</p>
      {selected.retailerEmail && <p>{selected.retailerEmail}</p>}
      {selected.notes && <p style={{ whiteSpace: "pre-wrap" }}>{selected.notes}</p>}
      {(selected.lineItems || []).map((line, index) => <div key={index} style={{ border: "1px solid #3B2A1E", borderRadius: 6, padding: 14, marginBottom: 10 }}>
        <strong>{line.cigarName || "Product not recorded"}</strong> · {line.vitola} {line.dims} · {line.packLabel}
        <div style={{ marginTop: 8 }}>{line.qty} × {orderMoney(line.unitPrice)} · Historical line total: {orderMoney(line.wholesaleTotal)}</div>
      </div>)}
      <p>Historical order total: <strong>{orderMoney(selected.totals?.wholesaleTotal)}</strong></p>
      <p style={{ color: "#8A93A0" }}>Retail value: {orderMoney(selected.totals?.retailTotal)} · Gross profit: {orderMoney(selected.totals?.grossProfit)} · Margin: {Number.isFinite(selected.totals?.marginPct) ? `${selected.totals.marginPct.toFixed(1)}%` : "Not recorded"}</p>
      <button className="hg-btn" style={userButtonStyle} onClick={() => { if (requirePermission("canUseOrderBuilder")) { setReview(true); setAcknowledged(false); } }}>Start New Order From This</button>
      {review && <div role="dialog" aria-modal="true" aria-label="Review reorder" style={{ position: "fixed", inset: 0, zIndex: 65, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div className="hg-scroll" style={{ background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: 20, width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto" }}>
          <h2 style={{ fontFamily: "'Bebas Neue', sans-serif" }}>Review Reorder</h2>
          {historyError && <p role="alert" style={{ color: "#d98a7c" }}>{historyError}</p>}
          <p>New order items use current prices. The historical order remains unchanged.</p>
          {plan.available.map(({ line, historicalPrice, activePrice }, index) => <div key={index} style={{ borderBottom: "1px solid #454b53", padding: "10px 0" }}>
            {line.cigarName} · {line.vitola} · {line.packLabel} × {line.qty}
            <div>Historical: {orderMoney(historicalPrice)} → Current: {orderMoney(line.unitPrice)}</div>
            {activePrice !== undefined && <div style={{ color: "#B8894C" }}>Matching active line: {orderMoney(activePrice)} → {orderMoney(line.unitPrice)}. Add mode combines quantities and reprices the combined line.</div>}
          </div>)}
          {plan.unavailable.length > 0 && <div style={{ color: "#d98a7c", marginTop: 14 }}>
            {plan.unavailable.map((line, index) => <p key={index}>{line.cigarName} · {line.vitola} · {line.packLabel}: {line.reason}</p>)}
            <label><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I understand these items will not be added.</label>
          </div>}
          {hasDraft && <p>Replace copies the saved retailer, email, notes and available items into your draft. Add keeps your current retailer, email and notes; only matching lines are repriced. Unrelated lines stay unchanged.</p>}
          {!plan.available.length && <p>No configurations are currently available to reorder.</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button className="hg-btn" style={userButtonStyle} disabled={!plan.available.length || (plan.unavailable.length > 0 && !acknowledged)} onClick={() => apply("replace")}>{hasDraft ? "Replace Current Order" : "Create Active Order"}</button>
            {hasDraft && <button className="hg-btn" style={userButtonStyle} disabled={!plan.available.length || (plan.unavailable.length > 0 && !acknowledged)} onClick={() => apply("add")}>Add Items to Current Order</button>}
            <button className="hg-btn" style={userButtonStyle} onClick={() => setReview(false)}>Cancel</button>
          </div>
        </div>
      </div>}
    </>}
  </div>;
}

function RetailerLocation({ retailer }) {
  const location = retailerLocation(retailer);
  return location ? React.createElement("div", { style: { display: "block", marginTop: 6, color: "#C9CFD6", whiteSpace: "normal", overflowWrap: "anywhere" } }, location) : null;
}
const hasMeaningfulDraft = (draft) => Boolean(draft.retailerId || draft.orderItems.length || [draft.orderRetailer, draft.orderEmail, draft.orderNotes].some((value) => value.trim()));
const retailerOrderFields = (retailer) => {
  if (!retailer?.active || !validRetailerId(retailer.id)) throw new Error("This retailer is no longer available for new orders.");
  return { retailerId: retailer.id, orderRetailer: retailer.name, orderEmail: retailer.email };
};
function RetailerPhoneInput({ value, country, disabled, onChange }) {
  return React.createElement("input", {
    "aria-label": "Phone", type: "tel", autoComplete: "tel", value, maxLength: 500, disabled,
    style: { ...userFieldStyle, boxSizing: "border-box" },
    onChange: (event) => {
      const next = event.target.value;
      // Leave middle edits, deletions and IME composition untouched until blur.
      const preserve = event.target.selectionStart !== next.length || event.nativeEvent?.inputType?.startsWith("delete") || event.nativeEvent?.isComposing;
      onChange(preserve ? next : formatRetailerPhone(next, country));
    },
    onBlur: (event) => onChange(formatRetailerPhone(event.target.value, country))
  });
}
function useAssignmentProfiles(user, enabled) {
  const scope = enabled ? user.uid : "";
  const [state, setState] = useState({ scope: "", profiles: [], ready: false, error: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ scope, profiles: [], ready: false, error: "" });
    if (!scope) return () => { live = false; };
    const stop = subscribeAssignmentProfiles((profiles) => {
      if (!live || auth.currentUser?.uid !== scope) return;
      setState({ scope, profiles, ready: true, error: "" });
    }, (error) => { if (live && auth.currentUser?.uid === scope) setState({ scope, profiles: [], ready: true, error: "Could not load assignment profiles: " + error.message }); });
    return () => { live = false; stop(); };
  }, [scope, retry]);
  return { ...(scope && state.scope === scope ? state : { profiles: [], ready: false, error: "" }), reload: () => setRetry((value) => value + 1) };
}
function RepAssignmentChoices({ value, onChange, repDirectory, disabled }) {
  const choices = repDirectory.profiles.filter((profile) => isAssignableRetailerUser(profile) || value.includes(profile.uid));
  const missing = value.filter((uid) => !choices.some((profile) => profile.uid === uid));
  return <fieldset disabled={disabled} style={{ border: "1px solid #555", padding: 12, margin: "16px 0", overflowWrap: "anywhere" }}>
    <legend>Assigned Users ({value.length}/10)</legend>
    {!value.length && <p>Unassigned</p>}
    {!repDirectory.ready && <p>Loading assignment profiles…</p>}
    {repDirectory.error && <p role="alert">{repDirectory.error} <button type="button" className="hg-btn" style={userButtonStyle} onClick={repDirectory.reload}>Retry</button></p>}
    {repDirectory.ready && !repDirectory.error && !repDirectory.profiles.some(isAssignableRetailerUser) && <p>No active Owners, Admins, or Field Reps are available.</p>}
    {[...choices.map((profile) => profile.uid), ...missing].map((uid) => <label key={uid} style={{ display: "block", margin: "8px 0" }}><input type="checkbox" checked={value.includes(uid)} disabled={!value.includes(uid) && (!repDirectory.ready || Boolean(repDirectory.error) || value.length >= 10)} onChange={(event) => onChange(event.target.checked ? [...value, uid] : value.filter((id) => id !== uid))} /> {assignedRepLabel(uid, "", true, repDirectory.profiles)}</label>)}
    <p style={{ color: "#8A93A0", marginBottom: 0 }}>Assignments indicate responsibility. All active retailers remain shared.</p>
  </fieldset>;
}
function RetailerAssignmentEditor({ retailer, user, repDirectory, requirePermission, onClose }) {
  const [expected] = useState(() => [...retailerAssignments(retailer)]);
  const [value, setValue] = useState(expected);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false), mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const submit = async (event) => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true; setSaving(true); setError("");
    try { await saveRetailerAssignments(retailer.id, value, expected, user.uid, requirePermission); if (mounted.current) onClose(); }
    catch (failure) { if (mounted.current) setError(failure.message); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label="Edit Assigned Users" style={{ position: "fixed", inset: 0, zIndex: 66, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", padding: 16 }}><form onSubmit={submit} className="hg-scroll" style={{ background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: 20, width: "100%", boxSizing: "border-box", maxWidth: 640, maxHeight: "85vh", overflowY: "auto" }}>
    <h2>Assigned Users — {retailer.name}</h2>
    <RepAssignmentChoices value={value} onChange={setValue} repDirectory={repDirectory} disabled={saving} />
    {error && <p role="alert" style={{ color: "#d98a7c" }}>{error}</p>}
    <button className="hg-btn" style={userButtonStyle} disabled={saving}>{saving ? "Saving…" : "Save Assignments"}</button> <button type="button" className="hg-btn" style={userButtonStyle} onClick={onClose}>Cancel</button>
  </form></div>;
}
function useRetailerDirectory(user, profile, enabled) {
  const scope = enabled ? `${user.uid}:${profile.role}` : "";
  const [state, setState] = useState({ scope: "", records: [], ready: false, error: "" });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ scope, records: [], ready: false, error: "" });
    if (!scope) return () => { live = false; };
    const manager = getProfilePermissions(profile).canChangeRetailerStatus;
    const stop = subscribeRetailerDirectory(manager, (records) => {
      if (!live || auth.currentUser?.uid !== user.uid) return;
      setState({ scope, records, ready: true, error: "" });
    }, (error) => { if (live) setState({ scope, records: [], ready: true, error: `Could not load retailers: ${error.message}` }); });
    return () => { live = false; stop(); };
  }, [scope, retry]);
  return { ...(state.scope === scope ? state : { records: [], ready: false, error: "" }), reload: () => setRetry((value) => value + 1) };
}
function RetailerEditor({ retailer, currentUid, canChangeStatus, canAssign, canEditTerritory, homeTerritory, territoryOptions, repDirectory, requirePermission, onClose, onSaved, onOpenExisting }) {
  const [form, setForm] = useState(() => ({ ...Object.fromEntries(Object.keys(RETAILER_FIELDS).map((key) => [key, retailer?.[key] || (key === "country" ? "United States" : "")])), phone: formatRetailerPhone(retailer?.phone || "", retailer?.country || ""), active: retailer?.active ?? true }));
  const [error, setError] = useState("");
  const [duplicateId, setDuplicateId] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [territory, setTerritory] = useState(() => territoryDisplay(retailer?.territory));
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => () => { mounted.current = false; }, []);
  const submit = async (event) => {
    event.preventDefault();
    if (busy.current || !requirePermission("canUseRetailers")) return;
    busy.current = true; setSaving(true); setError(""); setDuplicateId(null);
    try {
      const input = { ...form, ...(canEditTerritory ? { territory } : {}), ...(!retailer && canAssign ? { assignedRepUids: assignments } : {}) };
      const id = await saveRetailerProfile(retailer?.id, input, currentUid, requirePermission);
      if (mounted.current && auth.currentUser?.uid === currentUid && requirePermission("canUseRetailers")) onSaved(id);
    } catch (failure) { if (mounted.current) { setError(failure.message); setDuplicateId(failure.retailerId || null); } }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label={retailer ? "Edit Retailer" : "Add Retailer"} style={{ position: "fixed", inset: 0, zIndex: 65, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
    <form onSubmit={submit} className="hg-scroll" style={{ background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: 20, width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto" }}>
      <h2>{retailer ? "Edit Retailer" : "Add Retailer"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {Object.entries(RETAILER_FIELDS).map(([key, label]) => <label key={key}>{label}{key === "name" ? " *" : ""}
          {key === "phone" ? <RetailerPhoneInput value={form.phone} country={form.country} disabled={saving} onChange={(phone) => setForm((previous) => ({ ...previous, phone }))} /> : key === "notes" ? <textarea aria-label={label} value={form[key]} maxLength={5000} disabled={saving} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ ...userFieldStyle, boxSizing: "border-box" }} /> : <input aria-label={label} autoComplete={RETAILER_AUTOCOMPLETE[key]} value={form[key]} required={key === "name"} maxLength={500} disabled={saving} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ ...userFieldStyle, boxSizing: "border-box" }} />}
        </label>)}
      </div>
      {canEditTerritory ? <label style={{ display: "block", marginTop: 12 }}>Territory
        <input aria-label="Retailer territory" autoComplete="off" list="retailer-territory-options" value={territory} maxLength={500} disabled={saving} onChange={(event) => setTerritory(event.target.value)} style={{ ...userFieldStyle, boxSizing: "border-box" }} placeholder="Unassigned Territory" />
        <datalist id="retailer-territory-options">{territoryOptions.map((option) => <option key={option.value} value={option.label} />)}</datalist>
      </label> : <p>Territory: {retailer ? retailerTerritoryLabel(retailer) : territoryDisplay(homeTerritory) || "Unassigned Territory"}{!retailer && " (from your current user profile)"}</p>}
      {!retailer && canAssign && <RepAssignmentChoices value={assignments} onChange={setAssignments} repDirectory={repDirectory} disabled={saving} />}
      {retailer && canChangeStatus && <label><input type="checkbox" checked={form.active} disabled={saving} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>}
      {error && <p role="alert" style={{ color: "#d98a7c" }}>{error}</p>}
      {duplicateId && <button type="button" className="hg-btn" style={userButtonStyle} onClick={() => onOpenExisting(duplicateId)}>Open Existing Retailer</button>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}><button className="hg-btn" style={userButtonStyle} disabled={saving}>{saving ? "Saving…" : "Save Retailer"}</button><button type="button" className="hg-btn" style={userButtonStyle} onClick={onClose}>Cancel</button></div>
    </form>
  </div>;
}
function RetailerDirectory({ directory, selectedId, onSelect, user, profile, permissions, draft, requirePermission, onStartOrder, onHistory, onClose }) {
  const [search, setSearch] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [territoryFilter, setTerritoryFilter] = useState("all");
  const [editingAssignments, setEditingAssignments] = useState(false);
  const repDirectory = useAssignmentProfiles(user, permissions.canAssignRetailers);
  const [editor, setEditor] = useState(null);
  const [replace, setReplace] = useState(false);
  const selected = directory.records.find((item) => item.id === selectedId);
  useEffect(() => { setEditor(null); setReplace(false); setEditingAssignments(false); }, [selectedId, selected?.active]);
  const select = (id) => { if (requirePermission("canUseRetailers")) { setEditor(null); onSelect(id); } };
  const start = () => {
    if (!requirePermission("canUseRetailers") || !selected?.active) return;
    if (hasMeaningfulDraft(draft)) setReplace(true); else onStartOrder(selected.id);
  };
  const hasMine = directory.records.some((item) => retailerAssignments(item).includes(user.uid));
  const activeFilter = assignmentFilter || (permissions.canFilterOwnRetailers && !permissions.canAssignRetailers && hasMine ? "mine" : "all");
  const showMyRetailersEmptyState = activeFilter === "mine" && !hasMine;
  const territoryOptions = retailerTerritoryOptions(directory.records, permissions.canEditRetailerTerritory ? repDirectory.profiles : [], profile);
  const mismatches = territoryMismatches(selected, repDirectory.profiles, permissions.canEditRetailerTerritory);
  const results = filterRetailerTerritories(filterRetailerAssignments(directory.records, activeFilter, user.uid), territoryFilter, profile?.territory).filter((item) => retailerSearch(item, search));
  return <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
    <button className="hg-btn" style={userButtonStyle} onClick={selectedId ? () => select(null) : onClose}><ArrowLeft size={14} /> {selectedId ? "Back to Retailers" : "Back to list"}</button>
    <h1 style={{ fontFamily: "'Bebas Neue', sans-serif" }}>Retailers</h1>
    {directory.error && <p role="alert">{directory.error} <button className="hg-btn" style={userButtonStyle} onClick={directory.reload}>Reload Retailers</button></p>}
    {permissions.canAssignRetailers && repDirectory.error && <p role="alert">{repDirectory.error} Assignments are preserved. <button className="hg-btn" style={userButtonStyle} onClick={repDirectory.reload}>Retry</button></p>}
    {!directory.ready ? <p>Loading retailers…</p> : selectedId ? selected ? <>
      <h2>{selected.name}</h2><p>{selected.active ? "Active" : "Inactive — unavailable for new orders"}</p>
      {Object.entries(RETAILER_FIELDS).filter(([key]) => key !== "name").map(([key, label]) => selected[key] && <p key={key} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>{label}:</strong> {key === "phone" ? formatRetailerPhone(selected.phone, selected.country) : selected[key]}</p>)}
      <section style={{ overflowWrap: "anywhere" }}><h3>Territory</h3><p>{retailerTerritoryLabel(selected)}</p>
        {permissions.canEditRetailerTerritory && <button className="hg-btn" style={userButtonStyle} onClick={() => { if (requirePermission("canEditRetailerTerritory")) setEditor(selected); }}>Edit Territory</button>}
      </section>
      <section style={{ overflowWrap: "anywhere" }}><h3>Assigned Users</h3><p>{assignmentSummary(selected, user.uid, permissions.canAssignRetailers, repDirectory.profiles)}</p>
        {permissions.canAssignRetailers && <button className="hg-btn" style={userButtonStyle} onClick={() => { if (requirePermission("canAssignRetailers")) setEditingAssignments(true); }}>Edit Assigned Users</button>}
      </section>
      {permissions.canEditRetailerTerritory && mismatches.length > 0 && <div style={{ color: "#8A93A0", fontSize: 13, overflowWrap: "anywhere" }}>{mismatches.map((item) => <p key={item.uid}>{item.name} — Home territory: {item.territory} · Retailer: {retailerTerritoryLabel(selected)} · Cross-territory assignment (coverage is allowed)</p>)}</div>}
      <p>Created by {selected.creatorDisplayName || "Not recorded"} · {savedOrderDate(selected.createdAt)}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="hg-btn" style={userButtonStyle} onClick={() => { if (requirePermission("canUseRetailers")) setEditor(selected); }}>Edit Retailer</button>
        <button className="hg-btn" style={userButtonStyle} disabled={!selected.active} onClick={start}>Start New Order</button>
        <button className="hg-btn" style={userButtonStyle} onClick={() => { if (requirePermission("canUseRetailers")) onHistory(selected.id); }}>View Linked Orders</button>
      </div><p style={{ color: "#8A93A0" }}>Linked history uses exact retailer IDs. Older free-text orders remain available through Order History search.</p>
    </> : <p>This retailer is inactive, no longer exists, or is not available to your account.</p> : <>
      <button className="hg-btn" style={userButtonStyle} onClick={() => { if (requirePermission("canUseRetailers")) setEditor({}); }}>+ Add Retailer</button>
      <div style={{ marginTop: 16 }}><label>Assignment filter <select aria-label="Assignment filter" style={userFieldStyle} value={activeFilter} onChange={(event) => { setAssignmentFilter(event.target.value); if (!permissions.canEditRetailerTerritory) setTerritoryFilter("all"); }}>
        <option value="all">{permissions.canAssignRetailers ? "All Retailers" : "All Active Retailers"}</option>
        {permissions.canFilterOwnRetailers && <option value="mine">My Retailers</option>}
        {permissions.canAssignRetailers && <><option value="assigned">Assigned</option><option value="unassigned">Unassigned</option>{repDirectory.profiles.filter((profile) => isAssignableRetailerUser(profile) || directory.records.some((item) => retailerAssignments(item).includes(profile.uid))).map((profile) => <option key={profile.uid} value={"rep:" + profile.uid}>{assignedRepLabel(profile.uid, user.uid, true, repDirectory.profiles)}</option>)}</>}
      </select></label></div>
      {showMyRetailersEmptyState && <p>No retailers are currently assigned to you. <button className="hg-btn" style={userButtonStyle} onClick={() => setAssignmentFilter("all")}>{permissions.canAssignRetailers ? "All Retailers" : "All Active Retailers"}</button></p>}
      <div style={{ marginTop: 12 }}><label>Territory filter <select aria-label="Territory filter" style={userFieldStyle} value={territoryFilter} onChange={(event) => { setTerritoryFilter(event.target.value); if (!permissions.canEditRetailerTerritory) setAssignmentFilter("all"); }}>
        <option value="all">All Territories</option><option value="mine" disabled={!normalizeTerritory(profile?.territory)}>My Territory</option><option value="other">Other Territories</option><option value="unassigned">Unassigned Territory</option>
        {territoryOptions.map((option) => <option key={option.value} value={"territory:" + option.value}>{option.label}</option>)}
      </select></label><p style={{ color: "#8A93A0", fontSize: 13 }}>{permissions.canEditRetailerTerritory ? "Assignment and territory filters work together." : "My Retailers uses assignments; My Territory uses your current profile territory."} <button className="hg-btn" style={userButtonStyle} onClick={() => { setAssignmentFilter("all"); setTerritoryFilter("all"); setSearch(""); }}>{permissions.canAssignRetailers ? "Show All Retailers" : "Show All Active Retailers"}</button></p></div>
      {!normalizeTerritory(profile?.territory) && <p>No territory is currently assigned to your user profile.</p>}
      <input aria-label="Search retailers" placeholder="Search name, contact, city, state or territory…" style={{ ...userFieldStyle, boxSizing: "border-box", margin: "16px 0" }} value={search} onChange={(e) => setSearch(e.target.value)} />
      {!directory.records.length ? <p>No retailers yet.</p> : !results.length ? <p>No retailers match your search.</p> : results.map((item) => <button key={item.id} className="hg-btn" style={{ ...userButtonStyle, display: "block", width: "100%", textAlign: "left", padding: 16, marginBottom: 10 }} onClick={() => select(item.id)}>
        <strong>{item.name}</strong>{permissions.canChangeRetailerStatus && <span> · {item.active ? "Active" : "Inactive"}</span>}
        <RetailerLocation retailer={item} /><div style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>Territory: {retailerTerritoryLabel(item)}</div><div>{[item.contactName, item.email, formatRetailerPhone(item.phone, item.country)].filter(Boolean).join(" · ")}</div><div style={{ whiteSpace: "normal", overflowWrap: "anywhere", marginTop: 6 }}>{assignmentSummary(item, user.uid, permissions.canAssignRetailers, repDirectory.profiles, true)}</div>
      </button>)}
    </>}
    {editor && (!editor.id || (selected && (selected.active || permissions.canChangeRetailerStatus))) && <RetailerEditor retailer={editor.id ? editor : null} currentUid={user.uid} canChangeStatus={permissions.canChangeRetailerStatus} canAssign={permissions.canAssignRetailers} canEditTerritory={permissions.canEditRetailerTerritory} homeTerritory={profile?.territory} territoryOptions={territoryOptions} repDirectory={repDirectory} requirePermission={requirePermission} onClose={() => setEditor(null)} onSaved={select} onOpenExisting={select} />}
    {editingAssignments && selected && permissions.canAssignRetailers && <RetailerAssignmentEditor retailer={selected} user={user} repDirectory={repDirectory} requirePermission={requirePermission} onClose={() => setEditingAssignments(false)} />}
    {replace && selected?.active && <div role="dialog" aria-modal="true" aria-label="Replace current order" style={{ position: "fixed", inset: 0, zIndex: 65, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", padding: 16 }}><div style={{ background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: 24 }}><h2>Start New Order for {selected.name}?</h2><p>Your current active draft will be replaced. Saved orders remain unchanged.</p><button className="hg-btn" style={userButtonStyle} onClick={() => { if (requirePermission("canUseRetailers")) onStartOrder(selected.id, true); }}>Replace Current Order</button> <button className="hg-btn" style={userButtonStyle} onClick={() => setReplace(false)}>Cancel</button></div></div>}
  </div>;
}

function DetailOrderControls({ cigar, packOptions, orderItems, onAdd, onViewOrder }) {
  const [expanded, setExpanded] = useState(false);
  const [sizeKey, setSizeKey] = useState("");
  const [packKey, setPackKey] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [validation, setValidation] = useState("");
  const [notice, setNotice] = useState("");
  const packagesFor = (size) => packOptions.map((pack) => ({
    ...pack,
    price: pack.key === "single" ? getSinglePrice(size, "box") : getNumericPrice(size, pack.key),
  })).filter((pack) => Number.isFinite(pack.price) && pack.price >= 0);
  const sizes = (cigar.sizes || []).filter((size) => size.key && packagesFor(size).length);
  const size = sizes.find((item) => item.key === sizeKey);
  const packages = size ? packagesFor(size) : [];
  const pack = packages.find((item) => item.key === packKey);
  const totalQuantity = orderItems.reduce((sum, item) => sum + item.qty, 0);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const open = () => {
    const firstSize = sizes[0];
    setSizeKey(firstSize?.key || "");
    setPackKey(firstSize ? packagesFor(firstSize)[0].key : "");
    setQuantity("1");
    setValidation("");
    setNotice("");
    setExpanded(true);
  };
  const confirm = (event) => {
    event.preventDefault();
    const qty = Number(quantity);
    if (!quantity.trim() || !Number.isSafeInteger(qty) || qty < 1) {
      setValidation("Enter a whole-number quantity of 1 or more.");
      return;
    }
    if (!size || !pack) {
      setValidation("Select an available size and package with an order price.");
      return;
    }
    const existing = orderItems.find((item) => item.lineKey === `${cigar.id}__${size.key}__${pack.key}`);
    if (!Number.isSafeInteger((existing?.qty || 0) + qty)) {
      setValidation("This quantity is too large. Enter a smaller quantity.");
      return;
    }
    if (!onAdd(cigar, size, pack.key, qty)) {
      setValidation("Unable to add this item. Check your order access and the current selection.");
      return;
    }
    setExpanded(false);
    setValidation("");
    setNotice(`${cigar.name} ${size.vitola || size.dims} added to order.`);
  };
  const fieldStyle = { width: "100%", background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 };
  const buttonStyle = { background: "none", border: "1px solid #6E7681", color: "#C9CFD6", borderRadius: 4, padding: "8px 12px", fontFamily: "'Oswald', sans-serif", fontSize: 13 };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="hg-btn" onClick={open} disabled={!sizes.length} aria-expanded={expanded} style={{ ...buttonStyle, background: "#B8894C", color: "#14161A", opacity: sizes.length ? 1 : 0.5 }}><Plus size={14} /> Add to Order</button>
        <button type="button" className="hg-btn" onClick={onViewOrder} style={buttonStyle}><ShoppingCart size={14} /> View Order ({totalQuantity})</button>
      </div>
      {!sizes.length && <div style={{ color: "#8A93A0", fontSize: 12, marginTop: 8 }}>No sizes with available order pricing.</div>}
      <div role="status" aria-live="polite" style={{ color: "#B8894C", fontFamily: "'Oswald', sans-serif", fontSize: 13, marginTop: notice ? 8 : 0 }}>{notice}</div>
      {expanded && <form onSubmit={confirm} noValidate style={{ border: "1px solid #3B2A1E", borderRadius: 6, padding: 14, marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, fontFamily: "'Oswald', sans-serif", color: "#8A93A0", fontSize: 12 }}>
          <label>Vitola / Size
            <select value={sizeKey} onChange={(e) => { const next = sizes.find((item) => item.key === e.target.value); setSizeKey(e.target.value); setPackKey(next ? packagesFor(next)[0].key : ""); setValidation(""); }} style={fieldStyle}>
              {!size && <option value="">Select a size</option>}
              {sizes.map((item) => <option key={item.key} value={item.key}>{item.vitola || "Size"}{item.dims ? ` (${item.dims})` : ""}</option>)}
            </select>
          </label>
          <label>Package / Count
            <select value={packKey} onChange={(e) => { setPackKey(e.target.value); setValidation(""); }} style={fieldStyle}>
              {!pack && <option value="">Select a package</option>}
              {packages.map((item) => <option key={item.key} value={item.key}>{item.label} — ${item.price.toFixed(2)}</option>)}
            </select>
          </label>
          <label>Quantity
            <input type="number" min="1" step="1" value={quantity} onChange={(e) => { setQuantity(e.target.value); setValidation(""); }} style={fieldStyle} />
          </label>
        </div>
        {validation && <div role="alert" style={{ color: "#d98a7c", fontSize: 13, marginTop: 10 }}>{validation}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button type="submit" className="hg-btn" style={{ ...buttonStyle, background: "#B8894C", color: "#14161A" }}>Confirm Add</button>
          <button type="button" className="hg-btn" onClick={() => setExpanded(false)} style={buttonStyle}>Cancel</button>
        </div>
      </form>}
    </div>
  );
}

function HazeGrayReference() {
  const [cigars, setCigars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [strengthFilter, setStrengthFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [compareOrderId, setCompareOrderId] = useState(null);
  const [showOrderBuilder, setShowOrderBuilder] = useState(false);
  const [showFinalReview, setShowFinalReview] = useState(false);
  const [showOrderHistory, setShowOrderHistory] = useState(false);
  const [showRetailers, setShowRetailers] = useState(false);
  const [selectedRetailerId, setSelectedRetailerId] = useState(null);
  const [historyRetailerId, setHistoryRetailerId] = useState(null);
  const [retailerId, setRetailerId] = useState("");
  const draftOwnerRef = useRef(null);
  const [draftUid, setDraftUid] = useState(null);
  const [orderItems, setOrderItems] = useState([]);
  const [orderRetailer, setOrderRetailer] = useState("");
  const [orderEmail, setOrderEmail] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [copyConfirmed, setCopyConfirmed] = useState(false);


  const addToOrder = (cigar, size, packKey, quantity = 1) => {
  if (!requirePermission("canUseOrderBuilder")) return false;
  if (!Number.isSafeInteger(quantity) || quantity < 1) return false;
  const pack = PACK_OPTIONS.find((p) => p.key === packKey);
  if (!pack) return false;

  let unitPrice = null;

  if (packKey === "single") {
    unitPrice = getSinglePrice(size, "box");
  } else {
    unitPrice = getNumericPrice(size, packKey);
  }

  if (unitPrice == null) return false;

  const msrp = getNumericPrice(size, "msrp");

  let retailUnitValue = null;

  if (msrp != null) {
    if (packKey === "single") {
      retailUnitValue = msrp;
    } else if (packKey === "box10") {
      retailUnitValue = msrp * 10;
    } else if (
      packKey === "box20" ||
      packKey === "bundle20"
    ) {
      retailUnitValue = msrp * 20;
    }
  }

  const lineKey = `${cigar.id}__${size.key}__${packKey}`;

  setOrderItems((prev) => {
    const existing = prev.find(
      (li) => li.lineKey === lineKey
    );

    if (existing) {
      return prev.map((li) =>
        li.lineKey === lineKey
          ? { ...li, qty: li.qty + quantity }
          : li
      );
    }

    return [
      ...prev,
      {
        lineKey,
        cigarId: cigar.id,
        cigarName: cigar.name,
        vitola: size.vitola,
        dims: size.dims,
        packKey,
        packLabel: pack.label,
        unitPrice,
        retailUnitValue,
        qty: quantity,
      },
    ];
  });

  if (compareOrderId === cigar.id) {
    setCompareOrderId(null);
  }
  return true;
};

 const setOrderQty = (lineKey, qty) => {
  if (!requirePermission("canUseOrderBuilder")) return;
  setOrderItems((prev) => {
    if (qty <= 0) {
      return prev.filter((li) => li.lineKey !== lineKey);
    }

    return prev.map((li) =>
      li.lineKey === lineKey
        ? { ...li, qty }
        : li
    );
  });
};

  const removeOrderItem = (lineKey) => {
    if (!requirePermission("canUseOrderBuilder")) return;
    setOrderItems((prev) => prev.filter((li) => li.lineKey !== lineKey));
  };

  const clearOrder = () => {
  if (!requirePermission("canUseOrderBuilder")) return;
  try {
    localStorage.removeItem(orderDraftKey(draftOwnerRef.current));
  } catch (e) {
    // Clearing the in-memory order should still work if storage is unavailable.
  }
  setRetailerId("");
  setOrderItems([]);
  setOrderRetailer("");
  setOrderEmail("");
  setOrderNotes("");
  setCompareOrderId(null);
};
  
  const orderWholesaleTotal = orderItems.reduce(
  (sum, li) => sum + li.unitPrice * li.qty,
  0
);

const orderRetailTotal = orderItems.reduce(
  (sum, li) =>
    sum +
    (typeof li.retailUnitValue === "number"
      ? li.retailUnitValue * li.qty
      : 0),
  0
);

const orderGrossProfit =
  orderRetailTotal - orderWholesaleTotal;

const orderMarginPct =
  orderRetailTotal > 0
    ? (orderGrossProfit / orderRetailTotal) * 100
    : 0;

 const buildOrderText = () => {
  const lines = orderItems.map((li) => {
    const lineWholesale = li.unitPrice * li.qty;

    const lineRetail =
      typeof li.retailUnitValue === "number"
        ? li.retailUnitValue * li.qty
        : 0;

    const lineProfit = lineRetail - lineWholesale;

    const lineMargin =
      lineRetail > 0
        ? (lineProfit / lineRetail) * 100
        : 0;

    return [
      `${li.cigarName} — ${li.vitola}${li.dims ? " (" + li.dims + ")" : ""}`,
      `${li.packLabel} x${li.qty}`,
      `Wholesale: $${lineWholesale.toFixed(2)}`,
      `Retail Value: $${lineRetail.toFixed(2)}`,
      `Gross Profit: $${lineProfit.toFixed(2)}`,
      `Margin: ${lineMargin.toFixed(1)}%`,
    ].join("\n");
  });

  return [
    "HAZE GRAY CIGARS — RETAILER ORDER SUMMARY",
    "",
    `Retailer: ${orderRetailer || "—"}`,
    `Contact: ${orderEmail || "—"}`,
    "",
    ...lines.flatMap((line) => [line, ""]),
    "ORDER TOTALS",
    `Wholesale: $${orderWholesaleTotal.toFixed(2)}`,
    `Retail Value: $${orderRetailTotal.toFixed(2)}`,
    `Gross Profit: $${orderGrossProfit.toFixed(2)}`,
    `Margin: ${orderMarginPct.toFixed(1)}%`,
    "",
    orderNotes ? `Notes: ${orderNotes}` : "",
  ].join("\n");
};

 const emailOrder = () => {
  if (!requirePermission("canUseOrderBuilder")) return;
  if (orderItems.length === 0) {
    alert("Add at least one item to the order before emailing.");
    return;
  }

  const retailerName = orderRetailer.trim();
  const retailerEmail = orderEmail.trim();

  const subject = retailerName
    ? `Haze Gray Cigars Order — ${retailerName}`
    : "Haze Gray Cigars Order";

  const summary = buildOrderText();

  const body = [
    retailerName ? `Hello ${retailerName},` : "Hello,",
    "",
    "Thank you for your interest in Haze Gray Cigars.",
    "",
    "Below is the order summary we discussed, including suggested retail value and projected retailer economics.",
    "",
    summary,
    "",
    "Please review the order and let me know if you have any questions or would like to make any changes.",
  ].join("\n");

  const mailto =
    `mailto:${encodeURIComponent(retailerEmail)}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`;

  window.location.href = mailto;
};

  const copyOrderText = async () => {
    if (!requirePermission("canUseOrderBuilder")) return;
    try {
      await navigator.clipboard.writeText(buildOrderText());
      setCopyConfirmed(true);
      setTimeout(() => setCopyConfirmed(false), 2000);
    } catch (e) {
      // no-op
    }
  };
const openOrderFromCompare = (cigarId) => {
  if (!requirePermission("canUseOrderBuilder")) return;
  setCompareOrderId(cigarId);
  setShowCompare(false);
  setShowOrderBuilder(true);

  setTimeout(() => {
    const el = document.getElementById(`order-cigar-${cigarId}`);
    if (el) {
      el.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  }, 100);
};
  const toggleCompareId = (id) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [profileReady, setProfileReady] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [showAuthorizedUsers, setShowAuthorizedUsers] = useState(false);
  const accessRef = useRef({ uid: null, profile: null, permissions: NO_PERMISSIONS });
  const isAuthorizedUser = Boolean(user && profileReady && isActiveProfile(userProfile));
  const permissions = isAuthorizedUser ? getProfilePermissions(userProfile) : NO_PERMISSIONS;
  const { canEditCatalog, canEditPackages, canUseOrderBuilder, canUseFinalReview, canManageUsers, canMigrateLegacyData } = permissions;
  const directory = useRetailerDirectory(user, userProfile, permissions.canUseRetailers);
  const activeDraft = { orderItems, orderRetailer, orderEmail, orderNotes, retailerId };
  const clearProtectedDraft = () => {
    draftOwnerRef.current = null;
    setDraftUid(null);
    setRetailerId(""); setShowRetailers(false); setSelectedRetailerId(null); setHistoryRetailerId(null);
    setOrderItems([]); setOrderRetailer(""); setOrderEmail(""); setOrderNotes("");
    setShowOrderBuilder(false); setShowFinalReview(false); setShowOrderHistory(false);
    setCompareOrderId(null); setCopyConfirmed(false);
  };
  useEffect(() => {
    // Never persist a previous render's draft under a new account, or erase it during cleanup.
    if (!draftUid || draftOwnerRef.current !== draftUid || auth.currentUser?.uid !== draftUid ||
        accessRef.current.uid !== draftUid || !accessRef.current.permissions.canUseOrderBuilder) return;
    try {
      const key = orderDraftKey(draftUid);
      if (!orderItems.length && !orderRetailer && !orderEmail && !orderNotes && !retailerId) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ orderItems, orderRetailer, orderEmail, orderNotes, retailerId }));
    } catch { /* Keep the in-memory order usable when storage is unavailable. */ }
  }, [draftUid, orderItems, orderRetailer, orderEmail, orderNotes, retailerId]);

  useEffect(() => { if (!canUseOrderBuilder) setShowOrderHistory(false); }, [canUseOrderBuilder, user?.uid]);
  // Read current access inside handlers, including async continuations and stale callbacks.
  const requirePermission = useCallback((permission) => {
    const access = accessRef.current;
    if (access.uid && auth.currentUser?.uid === access.uid && access.permissions[permission] === true) return true;
    setError("You are not authorized to perform this action.");
    return false;
  }, []);

  useEffect(() => {
    let unsubscribeProfile = null;
    let generation = 0;
    const unsub = subscribeAuthState((u) => {
      const currentGeneration = ++generation;
      clearProtectedDraft();
      if (unsubscribeProfile) unsubscribeProfile();
      unsubscribeProfile = null;
      accessRef.current = { uid: u?.uid || null, profile: null, permissions: NO_PERMISSIONS };
      setFormOpen(false);
      setConfirmDeleteId(null);
      setShowOrderBuilder(false);
      setShowFinalReview(false);
      setShowAuthorizedUsers(false);
      setCompareOrderId(null);
      setUserProfile(null);
      setProfileReady(!u);
      setProfileError("");
      setUser(u);
      setAuthReady(true);
      if (!u) return;
      unsubscribeProfile = onSnapshot(doc(db, "users", u.uid), (snap) => {
        if (currentGeneration !== generation) return;
        const profile = snap.exists() ? snap.data() : null;
        accessRef.current = { uid: u.uid, profile, permissions: getProfilePermissions(profile) };
        if (!accessRef.current.permissions.canUseOrderBuilder) clearProtectedDraft();
        else if (draftOwnerRef.current !== u.uid) {
          const restored = loadOrderDraft(u.uid);
          draftOwnerRef.current = u.uid;
          setDraftUid(u.uid);
          setRetailerId(restored.retailerId || "");
          setOrderItems(restored.orderItems || []);
          setOrderRetailer(restored.orderRetailer || "");
          setOrderEmail(restored.orderEmail || "");
          setOrderNotes(restored.orderNotes || "");
        }
        setUserProfile(profile);
        setProfileReady(true);
        setProfileError("");
      }, (e) => {
        if (currentGeneration !== generation) return;
        accessRef.current = { uid: u.uid, profile: null, permissions: NO_PERMISSIONS };
        clearProtectedDraft();
        setUserProfile(null);
        setProfileReady(true);
        setProfileError("Could not load your authorization profile. (" + e.message + ")");
      });
    });
    return () => { generation++; unsub(); if (unsubscribeProfile) unsubscribeProfile(); accessRef.current = { uid: null, profile: null, permissions: NO_PERMISSIONS }; };
  }, []);

  useEffect(() => {
    if (!canEditCatalog) { setFormOpen(false); setConfirmDeleteId(null); }
    if (!canUseOrderBuilder) { setShowOrderBuilder(false); setCompareOrderId(null); }
    if (!canUseFinalReview) setShowFinalReview(false);
    if (!canManageUsers) setShowAuthorizedUsers(false);
  }, [canEditCatalog, canUseOrderBuilder, canUseFinalReview, canManageUsers]);

  const openOrderBuilder = () => {
    setShowRetailers(false);
    if (!requirePermission("canUseOrderBuilder")) return;
    setShowOrderHistory(false);
    setShowAuthorizedUsers(false);
    setShowFinalReview(false);
    setShowOrderBuilder(true);
  };
  const openFinalReview = () => {
    if (!requirePermission("canUseFinalReview")) return;
    setShowFinalReview(true);
  };
  const openAuthorizedUsers = () => {
    setShowRetailers(false);
    if (!requirePermission("canManageUsers")) return;
    setShowOrderHistory(false);
    setShowOrderBuilder(false);
    setShowFinalReview(false);
    setShowAuthorizedUsers(true);
  };
  const openOrderHistory = (filterId = null) => {
    setShowRetailers(false);
    setHistoryRetailerId(typeof filterId === "string" ? filterId : null);
    if (!requirePermission("canUseOrderBuilder")) return;
    setShowAuthorizedUsers(false); setShowFinalReview(false); setShowOrderBuilder(false); setShowOrderHistory(true);
  };
  const applyReorder = (order, reviewedPlan, mode) => {
    if (!requirePermission("canUseOrderBuilder")) return;
    const access = accessRef.current;
    if (access.uid !== user.uid || (!access.permissions.canManageUsers && order.creatorUid !== access.uid)) throw new Error("You are not authorized to reorder this order.");
    const currentPlan = buildReorderPlan(order, cigars, PACK_OPTIONS, orderItems);
    if (JSON.stringify(currentPlan) !== JSON.stringify(reviewedPlan)) throw new Error("Catalog or draft changed. Review the updated prices before confirming again.");
    if (!["replace", "add"].includes(mode) || !currentPlan.available.length) throw new Error("No valid reorder selection.");
    const next = mergeReorderItems(mode === "add" ? orderItems : [], currentPlan.available.map((item) => item.line));
    setOrderItems(next);
    if (mode === "replace") { setRetailerId(validRetailerId(order.retailerId) ? order.retailerId : ""); setOrderRetailer(order.retailerName || ""); setOrderEmail(order.retailerEmail || ""); setOrderNotes(order.notes || ""); }
    openOrderBuilder();
  };
  const openRetailer = (id = null) => {
    if (!requirePermission("canUseRetailers")) return;
    setSelectedRetailerId(id); setShowRetailers(true);
    setShowOrderHistory(false); setShowOrderBuilder(false); setShowFinalReview(false); setShowAuthorizedUsers(false);
  };
  const selectOrderRetailer = (id) => {
    if (!requirePermission("canUseOrderBuilder")) return;
    if (!id) { setRetailerId(""); return; }
    const retailer = directory.records.find((item) => item.id === id);
    try { const fields = retailerOrderFields(retailer); setRetailerId(fields.retailerId); setOrderRetailer(fields.orderRetailer); setOrderEmail(fields.orderEmail); }
    catch (failure) { setError(failure.message); }
  };
  const startRetailerOrder = (id, replaceConfirmed = false) => {
    if (hasMeaningfulDraft(activeDraft) && !replaceConfirmed) { setError("Confirm replacement of the current draft before starting a new retailer order."); return; }
    if (!requirePermission("canUseRetailers") || !requirePermission("canUseOrderBuilder")) return;
    const retailer = directory.records.find((item) => item.id === id);
    try {
      const fields = retailerOrderFields(retailer);
      setOrderItems([]); setOrderNotes(""); setRetailerId(fields.retailerId); setOrderRetailer(fields.orderRetailer); setOrderEmail(fields.orderEmail);
      openOrderBuilder();
    } catch (failure) { setError(failure.message); }
  };
  const saveAuthorizationProfile = async (uid, changes) => {
    await saveAuthorizationProfileService(uid, changes, {
      getCurrentUid: () => accessRef.current.uid,
      getManagerProfile: () => accessRef.current.profile,
      requirePermission
    });
  };

  const handleSignIn = async () => {
    setSignInError("");
    setSigningIn(true);
    try {
      await signInWithEmail(signInEmail, signInPassword);
      setSignInOpen(false);
      setSignInEmail("");
      setSignInPassword("");
    } catch (e) {
      setSignInError("Sign-in failed — check the email and password.");
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
    } catch (e) {
      // no-op
    }
  };

  const [canMigrate, setCanMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const saveCigarDoc = useCallback(async (record) => {
    if (!requirePermission("canEditCatalog")) return;
    try {
      await saveCatalogRecord(record);
      setError("");
    } catch (e) {
      setError("Save failed — your change may not persist. (" + e.message + ")");
    }
  }, [requirePermission]);

  const deleteCigarDoc = useCallback(async (id) => {
    if (!requirePermission("canEditCatalog")) return;
    try {
      await deleteCatalogRecord(id);
      setError("");
    } catch (e) {
      setError("Delete failed. (" + e.message + ")");
    }
  }, [requirePermission]);

  const migrateLegacyData = async () => {
    if (!requirePermission("canMigrateLegacyData")) return;
    const actingUid = accessRef.current.uid;
    setMigrating(true);
    try {
      const legacyCigars = await readLegacyCatalog();
      if (legacyCigars) {
        for (const c of legacyCigars) {
          if (!requirePermission("canMigrateLegacyData") || accessRef.current.uid !== actingUid) return;
          await saveCatalogRecord(c);
        }
      }
      setCanMigrate(false);
      setError("");
    } catch (e) {
      setError("Migration failed. (" + e.message + ")");
    } finally {
      setMigrating(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        if (await isLegacyCatalogMigrationAvailable()) setCanMigrate(true);
      } catch (e) {
        // Non-fatal — the live listener below will still try to load the collection.
      }
    })();

    const unsubscribe = subscribeCatalog(
      (list) => {
        setCigars(list);
        setLoading(false);
      },
      (e) => {
        setError("Could not reach the database. (" + e.message + ")");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handlePhotoFile = async (file) => {
    if (!requirePermission("canEditCatalog")) return;
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setForm((f) => ({ ...f, imageUrl: dataUrl }));
    } catch (e) {
      setUploadError("Couldn't process that photo — try a different file.");
    } finally {
      setUploading(false);
    }
  };

  const openAdd = () => { if (!requirePermission("canEditCatalog")) return; setForm(EMPTY_FORM); setEditingId(null); setUploadError(""); setFormOpen(true); };
  const openEdit = (c) => {
    if (!requirePermission("canEditCatalog")) return;
    setForm({
      ...c,
      tastingNotes: (c.tastingNotes || []).join(", "),
      pairings: (c.pairings || []).join(", "),
      sizes: c.sizes && c.sizes.length ? c.sizes.map((s) => ({ ...newSizeRow(), ...s })) : [newSizeRow()],
    });
    setEditingId(c.id);
    setUploadError("");
    setFormOpen(true);
  };

  const setSizeField = (idx, field, value) => {
    if (!requirePermission("canEditPackages")) return;
    setForm((f) => {
      const sizes = [...f.sizes];
      sizes[idx] = { ...sizes[idx], [field]: value };
      return { ...f, sizes };
    });
  };
  const addSizeRow = () => { if (requirePermission("canEditPackages")) setForm((f) => ({ ...f, sizes: [...f.sizes, newSizeRow()] })); };
  const removeSizeRow = (idx) => { if (requirePermission("canEditPackages")) setForm((f) => ({ ...f, sizes: f.sizes.filter((_, i) => i !== idx) })); };

  const saveForm = () => {
    if (!requirePermission("canEditCatalog") || !requirePermission("canEditPackages")) return;
    if (!form.name.trim()) return;
    const cleanSizes = form.sizes
    .map((s) => {
  const msrp = s.msrp.trim();
  const keystoneSingle = s.keystoneSingle.trim();
  const keystoneBox10 = s.keystoneBox10.trim();
  const keystoneBox20 = s.keystoneBox20.trim();
  const keystoneBundle20 = s.keystoneBundle20.trim();

  return {
    key: s.key,
    vitola: s.vitola.trim(),
    dims: s.dims.trim(),
    msrp,
    keystoneSingle,
    keystoneBox10,
    keystoneBox20,
    keystoneBundle20,

    pricing: {
      msrp: parseMoney(msrp),
      boxSingle: getSinglePrice(
        { keystoneSingle },
        "box"
      ),
      bundleSingle: getSinglePrice(
        { keystoneSingle },
        "bundle"
      ),
      box10: parseMoney(keystoneBox10),
      box20: parseMoney(keystoneBox20),
      bundle20: parseMoney(keystoneBundle20),
    },
  };
})
      .filter((s) => s.vitola || s.dims || s.msrp || s.keystoneSingle || s.keystoneBox10 || s.keystoneBox20 || s.keystoneBundle20);
    const record = {
      ...form,
      id: editingId || `c-${Date.now()}`,
      strength: Number(form.strength) || 1,
      body: Number(form.body) || 1,
      tastingNotes: form.tastingNotes.split(",").map((s) => s.trim()).filter(Boolean),
      pairings: form.pairings.split(",").map((s) => s.trim()).filter(Boolean),
      sizes: cleanSizes,
    };
    saveCigarDoc(record);
    setFormOpen(false);
  };

  const doDelete = (id) => {
    if (!requirePermission("canEditCatalog")) return;
    deleteCigarDoc(id);
    setConfirmDeleteId(null);
    if (selectedId === id) setSelectedId(null);
  };

  const filtered = cigars
    .filter((c) => {
      const q = query.toLowerCase();
      if (!q) return true;
      const sizeText = (c.sizes || []).map((s) => `${s.vitola} ${s.dims}`).join(" ");
      return [c.name, c.line, c.wrapper, sizeText, ...(c.tastingNotes || [])]
        .join(" ").toLowerCase().includes(q);
    })
    .filter((c) => strengthFilter === "all" || String(c.strength) === strengthFilter)
    .sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      if (sortBy === "strength-asc") return (a.strength || 0) - (b.strength || 0);
      if (sortBy === "strength-desc") return (b.strength || 0) - (a.strength || 0);
      if (sortBy === "body-asc") return (a.body || 0) - (b.body || 0);
      if (sortBy === "body-desc") return (b.body || 0) - (a.body || 0);
      return 0;
    });

  const selected = cigars.find((c) => c.id === selectedId);

  const strengthWord = (v) => (["", "Mild", "Mild-Medium", "Medium", "Medium-Full", "Full"][v] || "—");
  const sizeSummary = (c) => (c.sizes || []).map((s) => s.vitola).filter(Boolean).join(" · ") || "—";

  const groupedFiltered = (() => {
    const groups = {};
    filtered.forEach((c) => {
      const key = (c.line || "").trim() || "Uncategorized";
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    const names = Object.keys(groups).sort((a, b) => {
      if (a === "Uncategorized") return 1;
      if (b === "Uncategorized") return -1;
      return a.localeCompare(b);
    });
    return names.map((name) => ({ name, items: groups[name] }));
  })();

  return (
    <div style={{
      minHeight: "100%", background: "#14161A",
      backgroundImage: "radial-gradient(circle at 20% 0%, #1c1f24 0%, #14161A 55%)",
      color: "#EDE6D6", fontFamily: "'Lora', serif", padding: "0 0 40px 0",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@400;500;600&family=Lora:ital@0;1&family=JetBrains+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        .hg-scroll::-webkit-scrollbar { width: 8px; }
        .hg-scroll::-webkit-scrollbar-thumb { background: #454b53; border-radius: 4px; }
        .hg-row:hover { background: rgba(184,137,76,0.08) !important; border-color: #B8894C !important; }
        .hg-btn { cursor: pointer; transition: opacity 0.15s ease, transform 0.1s ease; }
        .hg-btn:hover { opacity: 0.85; }
        .hg-btn:active { transform: scale(0.97); }
        input, textarea { font-family: 'Lora', serif; }
        input:focus, textarea:focus { outline: 2px solid #B8894C; outline-offset: 1px; }
        .hg-spin { animation: hg-spin 0.9s linear infinite; }
        @keyframes hg-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: "1px solid #2c3036", padding: "26px 24px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={LOGO_DATA_URL} alt="Haze Gray Cigars" style={{ width: 52, height: 52, objectFit: "contain", flexShrink: 0 }} />
          <div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, letterSpacing: 3, lineHeight: 1 }}>
              HAZE GRAY <span style={{ color: "#B8894C" }}>CIGARS</span>
            </div>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, letterSpacing: 3, color: "#8A93A0", textTransform: "uppercase" }}>
              Field Reference — Quick Card System
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {user ? (
            <>
              {isAuthorizedUser && (
                <div style={{ fontFamily: "'Oswald', sans-serif", color: "#EDE6D6" }}>
                  <div>{userProfile.displayName || userProfile.email || user.email}</div>
                  <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#B8894C", textTransform: "uppercase" }}>{ROLE_LABELS[userProfile.role]}</div>
                </div>
              )}
              {canMigrateLegacyData && canMigrate && (
                <button className="hg-btn" onClick={migrateLegacyData} disabled={migrating} style={{
                  display: "flex", alignItems: "center", gap: 8, background: "#A8402E", color: "#EDE6D6",
                  border: "none", borderRadius: 4, padding: "10px 16px", fontFamily: "'Oswald', sans-serif",
                  fontWeight: 600, letterSpacing: 1, fontSize: 12, textTransform: "uppercase",
                }}>
                  {migrating ? <Loader2 size={15} className="hg-spin" /> : null}
                  {migrating ? "Migrating…" : "Migrate Legacy Data"}
                </button>
              )}
              {canUseOrderBuilder && <button className="hg-btn" onClick={openOrderBuilder} style={{
                display: "flex", alignItems: "center", gap: 8, background: "none", color: "#C9CFD6",
                border: "1px solid #6E7681", borderRadius: 4, padding: "10px 16px", fontFamily: "'Oswald', sans-serif",
                fontWeight: 500, letterSpacing: 1, fontSize: 12, textTransform: "uppercase",
              }}>
                <ShoppingCart size={15} /> Order Builder{orderItems.length > 0 ? ` (${orderItems.length})` : ""}
              </button>}
              {permissions.canUseRetailers && <button className="hg-btn" onClick={() => openRetailer()} style={userButtonStyle}>Retailers</button>}
              {canUseOrderBuilder && <button className="hg-btn" onClick={() => openOrderHistory()} style={userButtonStyle}>Order History</button>}
              {canEditCatalog && <button className="hg-btn" onClick={openAdd} style={{
                display: "flex", alignItems: "center", gap: 8, background: "#B8894C", color: "#14161A",
                border: "none", borderRadius: 4, padding: "10px 16px", fontFamily: "'Oswald', sans-serif",
                fontWeight: 600, letterSpacing: 1, fontSize: 13, textTransform: "uppercase",
              }}>
                <Plus size={16} /> Add Cigar
              </button>}
              {canManageUsers && <button className="hg-btn" onClick={openAuthorizedUsers} style={userButtonStyle}>Authorized Users</button>}
              <button className="hg-btn" onClick={handleSignOut} style={{
                background: "none", border: "1px solid #454b53", color: "#8A93A0", borderRadius: 4,
                padding: "10px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 12, letterSpacing: 0.5,
              }} title={user.email}>
                Sign Out
              </button>
            </>
          ) : (
            authReady && (
              <button className="hg-btn" onClick={() => setSignInOpen(true)} style={{
                background: "none", border: "1px solid #6E7681", color: "#C9CFD6", borderRadius: 4,
                padding: "10px 16px", fontFamily: "'Oswald', sans-serif", fontWeight: 500, letterSpacing: 1,
                fontSize: 12.5, textTransform: "uppercase",
              }}>
                Sign In to Edit
              </button>
            )
          )}
        </div>
      </div>

      {user && !profileReady && <div role="status" style={{ margin: "12px 24px", color: "#8A93A0", fontFamily: "'Oswald', sans-serif" }}>Checking authorization…</div>}
      {user && profileReady && !isAuthorizedUser && (
        <div role="alert" style={{ margin: "12px 24px", padding: "10px 14px", border: "1px solid #A8402E", borderRadius: 4, color: "#EDE6D6", fontFamily: "'Oswald', sans-serif" }}>
          Your account is signed in but is not authorized to use protected Haze Gray features.
          {profileError && <div style={{ color: "#d98a7c", fontSize: 12, marginTop: 6 }}>{profileError}</div>}
        </div>
      )}

      {error && (
        <div style={{ margin: "12px 24px 0", padding: "8px 14px", background: "rgba(168,64,46,0.15)", border: "1px solid #A8402E", borderRadius: 4, fontSize: 13, fontFamily: "'Oswald', sans-serif" }}>
          {error}
        </div>
      )}

      {showRetailers && permissions.canUseRetailers ? (
        <RetailerDirectory key={`${user.uid}:${userProfile.role}`} directory={directory} selectedId={selectedRetailerId} onSelect={setSelectedRetailerId} user={user} profile={userProfile} permissions={permissions} draft={activeDraft} requirePermission={requirePermission} onStartOrder={startRetailerOrder} onHistory={openOrderHistory} onClose={() => setShowRetailers(false)} />
      ) : showOrderHistory && canUseOrderBuilder ? (
        <OrderHistory retailerFilter={historyRetailerId} onOpenRetailer={openRetailer} key={`${user.uid}:${userProfile.role}:${historyRetailerId || "all"}`} user={user} profile={userProfile} cigars={cigars} packOptions={PACK_OPTIONS} draft={activeDraft} requirePermission={requirePermission} onApplyReorder={applyReorder} onClose={() => { setShowOrderHistory(false); setShowCompare(false); setSelectedId(null); }} />
      ) : showAuthorizedUsers && canManageUsers ? (
        <AuthorizedUsers key={user.uid} currentUid={user.uid} managerProfile={userProfile} requirePermission={requirePermission} onSave={saveAuthorizationProfile} onClose={() => { setShowAuthorizedUsers(false); setShowCompare(false); setSelectedId(null); }} />
      ) : loading ? (
        <div style={{ padding: 40, fontFamily: "'Oswald', sans-serif", color: "#8A93A0" }}>Loading manifest…</div>
    ) : showFinalReview && canUseFinalReview ? (
  // ---------- FINAL REVIEW ----------
  <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px" }}>

    <button
      className="hg-btn"
      onClick={() => setShowFinalReview(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "none",
        border: "none",
        color: "#B8894C",
        fontFamily: "'Oswald', sans-serif",
        fontSize: 13,
        letterSpacing: 1,
        textTransform: "uppercase",
        padding: "6px 0",
        marginBottom: 18
      }}
    >
      <ArrowLeft size={16} /> Back to Order Builder
    </button>

    <div
      style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 32,
        letterSpacing: 1,
        marginBottom: 6
      }}
    >
      Final Review
    </div>

    <div
      style={{
        fontFamily: "'Oswald', sans-serif",
        color: "#8A93A0",
        fontSize: 13,
        letterSpacing: 1,
        marginBottom: 24
      }}
    >
      REVIEW ORDER BEFORE SUBMISSION
    </div>
{/* Retailer Information */}
<div
  style={{
    border: "1px solid #2C3036",
    borderRadius: 8,
    padding: "16px 18px",
    marginBottom: 20
  }}
>
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 20
    }}
  >
    <div>
      <div style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 11,
        letterSpacing: 1.5,
        color: "#8A93A0",
        textTransform: "uppercase",
        marginBottom: 4
      }}>
        Retailer
      </div>
      <div style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 17,
        color: "#EDE6D6"
      }}>
        {orderRetailer || "—"}
      </div>
    </div>

    <div>
      <div style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 11,
        letterSpacing: 1.5,
        color: "#8A93A0",
        textTransform: "uppercase",
        marginBottom: 4
      }}>
        Contact Email
      </div>
      <div style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 17,
        color: "#EDE6D6"
      }}>
        {orderEmail || "—"}
      </div>
    </div>
  </div>
</div>

{/* Final Order */}
<div style={{
  border: "1px solid #2C3036",
  borderRadius: 8,
  overflow: "hidden",
  marginBottom: 20
}}>
  <div style={{
    display: "grid",
    gridTemplateColumns: "2fr 1.2fr 1.2fr .6fr 1fr",
    gap: 12,
    padding: "12px 16px",
    background: "#1B1E22",
    borderBottom: "1px solid #2C3036",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 11,
    letterSpacing: 1.5,
    color: "#8A93A0",
    textTransform: "uppercase"
  }}>
    <div>Cigar</div>
    <div>Size</div>
    <div>Package</div>
    <div>Qty</div>
    <div style={{ textAlign: "right" }}>Total</div>
  </div>

  {orderItems.map((li) => {
    const lineTotal = li.unitPrice * li.qty;

    return (
      <div
        key={li.lineKey}
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1.2fr 1.2fr .6fr 1fr",
          gap: 12,
          padding: "14px 16px",
          borderBottom: "1px solid #2C3036",
          alignItems: "center"
        }}
      >
        <div style={{
          fontFamily: "'Oswald', sans-serif",
          fontWeight: 600,
          color: "#EDE6D6"
        }}>
          {li.cigarName}
        </div>

        <div style={{
          fontFamily: "'Oswald', sans-serif",
          color: "#C9CFD6"
        }}>
          {li.vitola} {li.dims ? `(${li.dims})` : ""}
        </div>

        <div style={{
          fontFamily: "'Oswald', sans-serif",
          color: "#C9CFD6"
        }}>
          {li.packLabel}
        </div>

        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: "#EDE6D6"
        }}>
          {li.qty}
        </div>

        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: "#EDE6D6",
          textAlign: "right"
        }}>
          ${lineTotal.toFixed(2)}
        </div>
      </div>
    );
  })}

  <div style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px",
    background: "rgba(184,137,76,0.08)"
  }}>
    <div style={{
      fontFamily: "'Oswald', sans-serif",
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: 1.5,
      color: "#B8894C",
      textTransform: "uppercase"
    }}>
      Order Total
    </div>

    <div style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 22,
      color: "#EDE6D6"
    }}>
      ${orderWholesaleTotal.toFixed(2)}
    </div>
  </div>
</div>

{orderNotes && (
  <div style={{
    border: "1px solid #2C3036",
    borderRadius: 8,
    padding: "16px 18px",
    marginBottom: 20
  }}>
    <div style={{
      fontFamily: "'Oswald', sans-serif",
      fontSize: 11,
      letterSpacing: 1.5,
      color: "#8A93A0",
      textTransform: "uppercase",
      marginBottom: 6
    }}>
      Notes
    </div>

    <div style={{
      fontFamily: "'Lora', serif",
      color: "#C9CFD6",
      lineHeight: 1.6
    }}>
      {orderNotes}
    </div>
  </div>
)}
<SaveOrderPanel key={`${user.uid}:${userProfile.role}`} draft={activeDraft} user={user} profile={userProfile} cigars={cigars} packOptions={PACK_OPTIONS} requirePermission={requirePermission} onContinue={openOrderBuilder} onStartNew={() => { clearOrder(); openOrderBuilder(); }} />
<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
  <button
    className="hg-btn"
    onClick={() => {
      if (!requirePermission("canUseFinalReview")) return;
      const retailerName = orderRetailer.trim();
      const retailerEmail = orderEmail.trim();

 const orderLines = orderItems.map((li, index) => {
  const lineTotal = li.unitPrice * li.qty;
  const size = `${li.vitola}${li.dims ? ` (${li.dims})` : ""}`;

 return [
  `${index + 1}. ${li.cigarName}`,
  `   ${size}`,
  `   Package: ${li.packLabel}`,
  `   Quantity: ${li.qty}`,
  `   Line Total: $${lineTotal.toFixed(2)}`
].join("\n");
});

const body = [
  "HAZE GRAY CIGARS — FINAL ORDER",
  "",
  retailerName ? `Retailer: ${retailerName}` : "",
  retailerEmail ? `Contact: ${retailerEmail}` : "",
  "",
  ...orderLines.flatMap((line) => [line, ""]),
  "----------------------------------------",
  `ORDER TOTAL: $${orderWholesaleTotal.toFixed(2)}`,
  "",
  orderNotes ? `Notes: ${orderNotes}` : ""
].join("\n");

      const subject = retailerName
        ? `Haze Gray Cigars Order — ${retailerName}`
        : "Haze Gray Cigars Order";

      const mailto =
        `mailto:${encodeURIComponent(retailerEmail)}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`;

      window.location.href = mailto;
    }}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: "#B8894C",
      border: "none",
      color: "#14161A",
      borderRadius: 4,
      padding: "10px 18px",
      fontFamily: "'Oswald', sans-serif",
      fontWeight: 600,
      fontSize: 13
    }}
  >
    <Mail size={15} />
    Email Order
  </button>

  <button
    className="hg-btn"
    onClick={async () => {
      if (!requirePermission("canUseFinalReview")) return;
      const orderLines = orderItems.map((li, index) => {
  const lineTotal = li.unitPrice * li.qty;
  const size = `${li.vitola}${li.dims ? ` (${li.dims})` : ""}`;

  return [
    `${index + 1}. ${li.cigarName}`,
    `   ${size}`,
    `   Package: ${li.packLabel}`,
    `   Quantity: ${li.qty}`,
    `   Line Total: $${lineTotal.toFixed(2)}`
  ].join("\n");
});

const text = [
  "HAZE GRAY CIGARS — FINAL ORDER",
  "",
  orderRetailer ? `Retailer: ${orderRetailer}` : "",
  orderEmail ? `Contact: ${orderEmail}` : "",
  "",
  ...orderLines.flatMap((line) => [line, ""]),
  "----------------------------------------",
  `ORDER TOTAL: $${orderWholesaleTotal.toFixed(2)}`,
  "",
  orderNotes ? `Notes: ${orderNotes}` : ""
].join("\n");

      await navigator.clipboard.writeText(text);
      setCopyConfirmed(true);
      setTimeout(() => setCopyConfirmed(false), 2000);
    }}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: "none",
      border: "1px solid #6E7681",
      color: "#C9CFD6",
      borderRadius: 4,
      padding: "10px 18px",
      fontFamily: "'Oswald', sans-serif",
      fontWeight: 500,
      fontSize: 13
    }}
  >
    <Copy size={15} />
    {copyConfirmed ? "Copied!" : "Copy Order"}
  </button>

  <button
    className="hg-btn"
    onClick={() => setShowFinalReview(false)}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      background: "none",
      border: "1px solid #6E7681",
      color: "#C9CFD6",
      borderRadius: 4,
      padding: "10px 18px",
      fontFamily: "'Oswald', sans-serif",
      fontWeight: 500,
      fontSize: 13
    }}
  >
    <ArrowLeft size={15} />
    Back to Builder
  </button>
</div>
  </div>

) : showOrderBuilder && canUseOrderBuilder ? (
  // ---------- ORDER BUILDER ----------
  <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px" }}>
          <button className="hg-btn" onClick={() => setShowOrderBuilder(false)} style={{
            display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
            color: "#B8894C", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1,
            textTransform: "uppercase", padding: "6px 0", marginBottom: 18,
          }}>
            <ArrowLeft size={16} /> Back to list
          </button>

          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 1, marginBottom: 16 }}>Order Builder</div>

          <div style={{ border: "1px solid #2c3036", borderRadius: 8, padding: "16px 18px", marginBottom: 20 }}>
            <label>Select Existing Retailer or Manual Entry
              <select aria-label="Order retailer" value={retailerId} onChange={(e) => selectOrderRetailer(e.target.value)} style={{ ...userFieldStyle, marginBottom: 12 }}>
                <option value="">One-time / Manual Retailer</option>
                {retailerId && !directory.records.some((item) => item.id === retailerId && item.active) && <option value={retailerId}>Linked retailer unavailable</option>}
                {directory.records.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {directory.error && <p role="alert">{directory.error} <button className="hg-btn" style={userButtonStyle} onClick={directory.reload}>Reload Retailers</button></p>}
            {retailerId && directory.ready && !directory.records.some((item) => item.id === retailerId && item.active) && <p role="alert" style={{ color: "#d98a7c" }}>The linked retailer is inactive or unavailable. Your captured name/email are preserved. Select another retailer or switch to manual entry.</p>}
            {retailerId && <p>Linked retailer snapshot. Switch to manual entry to edit name/email. Customer notes are not copied into order notes.</p>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>Retailer Name</label>
                <input disabled={Boolean(retailerId)} value={orderRetailer} onChange={(e) => { if (requirePermission("canUseOrderBuilder")) setOrderRetailer(e.target.value); }} style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }} />
              </div>
              <div>
                <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>Retailer Contact Email</label>
                <input disabled={Boolean(retailerId)} value={orderEmail} onChange={(e) => { if (requirePermission("canUseOrderBuilder")) setOrderEmail(e.target.value); }} style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }} />
              </div>
            </div>
            <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>Notes</label>
            <textarea value={orderNotes} onChange={(e) => { if (requirePermission("canUseOrderBuilder")) setOrderNotes(e.target.value); }} rows={2} style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14, resize: "vertical" }} />
          </div>

          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 10 }}>Add Cigars</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
            {cigars.map((c) => (
             <div
  key={c.id}
  id={`order-cigar-${c.id}`}
  style={{
    border: compareOrderId === c.id
      ? "1px solid #B8894C"
      : "1px solid #2c3036",
    borderRadius: 6,
    padding: "12px 14px",
    background: compareOrderId === c.id
      ? "rgba(184,137,76,0.06)"
      : "transparent"
  }}
>
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 0.5, marginBottom: 8 }}>{c.name}</div>
                {(c.sizes || []).length === 0 ? (
                  <div style={{ color: "#5c636b", fontSize: 12.5, fontStyle: "italic" }}>No sizes on file.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {c.sizes.map((s) => (
                      <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#C9CFD6", minWidth: 140 }}>
                          {s.vitola}{s.dims ? ` (${s.dims})` : ""}
                        </div>
                        {PACK_OPTIONS.map((pack) => {
                          const price =
  pack.key === "single"
    ? getSinglePrice(s, "box")
    : getNumericPrice(s, pack.key);
                          if (price == null) return null;
                          return (
                            <button
                              key={pack.key}
                              type="button"
                              className="hg-btn"
                              onClick={() => addToOrder(c, s, pack.key)}
                              style={{
                                background: "none", border: "1px solid #454b53", color: "#C9CFD6",
                                borderRadius: 4, padding: "5px 10px", fontFamily: "'Oswald', sans-serif", fontSize: 11.5,
                              }}
                            >
                              + {pack.label} (${price.toFixed(2)})
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 10 }}>Order Summary</div>
          {orderItems.length === 0 ? (
            <div style={{ color: "#5c636b", fontSize: 13.5, fontStyle: "italic", marginBottom: 20 }}>No items added yet — use the buttons above.</div>
          ) : (
            <div style={{ border: "1px solid #2c3036", borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
             {orderItems.map((li) => {
  const lineWholesale = li.unitPrice * li.qty;

  const lineRetail =
    typeof li.retailUnitValue === "number"
      ? li.retailUnitValue * li.qty
      : 0;

  const lineProfit = lineRetail - lineWholesale;

  const lineMargin =
    lineRetail > 0
      ? (lineProfit / lineRetail) * 100
      : 0;

  return (
    <div
      key={li.lineKey}
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid #2c3036"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap"
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 180,
            fontFamily: "'Oswald', sans-serif",
            fontSize: 13,
            color: "#EDE6D6"
          }}
        >
          {li.cigarName} — {li.vitola}
          {li.dims ? ` (${li.dims})` : ""} — {li.packLabel}
        </div>

        <button
          className="hg-btn"
          onClick={() => setOrderQty(li.lineKey, li.qty - 1)}
          style={{
            background: "none",
            border: "1px solid #454b53",
            color: "#C9CFD6",
            borderRadius: 4,
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Minus size={12} />
        </button>

        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: "#EDE6D6",
            minWidth: 22,
            textAlign: "center"
          }}
        >
          {li.qty}
        </div>

        <button
          className="hg-btn"
          onClick={() => setOrderQty(li.lineKey, li.qty + 1)}
          style={{
            background: "none",
            border: "1px solid #454b53",
            color: "#C9CFD6",
            borderRadius: 4,
            width: 26,
            height: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <Plus size={12} />
        </button>

        <button
          className="hg-btn"
          onClick={() => removeOrderItem(li.lineKey)}
          style={{
            background: "none",
            border: "none",
            color: "#8A93A0"
          }}
        >
          <X size={16} />
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(110px, 1fr))",
          gap: 10,
          marginTop: 10,
          paddingTop: 9,
          borderTop: "1px solid rgba(69,75,83,0.45)"
        }}
      >
        <div>
          <div style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9.5,
            letterSpacing: 1.2,
            color: "#8A93A0",
            textTransform: "uppercase"
          }}>
            Wholesale
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: "#EDE6D6",
            marginTop: 2
          }}>
            ${lineWholesale.toFixed(2)}
          </div>
        </div>

        <div>
          <div style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9.5,
            letterSpacing: 1.2,
            color: "#8A93A0",
            textTransform: "uppercase"
          }}>
            Retail Value
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: "#EDE6D6",
            marginTop: 2
          }}>
            ${lineRetail.toFixed(2)}
          </div>
        </div>

        <div>
          <div style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9.5,
            letterSpacing: 1.2,
            color: "#8A93A0",
            textTransform: "uppercase"
          }}>
            Gross Profit
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: "#B8894C",
            marginTop: 2
          }}>
            ${lineProfit.toFixed(2)}
          </div>
        </div>

        <div>
          <div style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 9.5,
            letterSpacing: 1.2,
            color: "#8A93A0",
            textTransform: "uppercase"
          }}>
            Margin
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            color: "#B8894C",
            marginTop: 2
          }}>
            {lineMargin.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
})}
<div
  style={{
    padding: "12px 14px 6px",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 1.6,
    color: "#B8894C",
    textTransform: "uppercase"
  }}
>
  Order Totals
</div>
              <div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
    padding: "14px",
    background: "rgba(184,137,76,0.06)"
  }}
>
  <div>
    <div
      style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 10,
        letterSpacing: 1.3,
        color: "#8A93A0",
        textTransform: "uppercase"
      }}
    >
      Wholesale
    </div>
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 16,
        color: "#EDE6D6",
        marginTop: 3
      }}
    >
      ${orderWholesaleTotal.toFixed(2)}
    </div>
  </div>

  <div>
    <div
      style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 10,
        letterSpacing: 1.3,
        color: "#8A93A0",
        textTransform: "uppercase"
      }}
    >
      Retail Value
    </div>
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 16,
        color: "#EDE6D6",
        marginTop: 3
      }}
    >
      ${orderRetailTotal.toFixed(2)}
    </div>
  </div>

  <div>
    <div
      style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 10,
        letterSpacing: 1.3,
        color: "#8A93A0",
        textTransform: "uppercase"
      }}
    >
      Gross Profit
    </div>
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 16,
        color: "#B8894C",
        marginTop: 3
      }}
    >
      ${orderGrossProfit.toFixed(2)}
    </div>
  </div>

  <div>
    <div
      style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 10,
        letterSpacing: 1.3,
        color: "#8A93A0",
        textTransform: "uppercase"
      }}
    >
      Margin
    </div>
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 16,
        color: "#B8894C",
        marginTop: 3
      }}
    >
      {orderMarginPct.toFixed(1)}%
    </div>
  </div>
</div>
            </div>
          )}

          {orderItems.length > 0 && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="hg-btn" onClick={emailOrder} style={{
                display: "flex", alignItems: "center", gap: 8, background: "#B8894C", border: "none", color: "#14161A",
                borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 13,
              }}>
                <Mail size={15} /> Email Summary
              </button>
              <button className="hg-btn" onClick={copyOrderText} style={{
                display: "flex", alignItems: "center", gap: 8, background: "none", border: "1px solid #6E7681", color: "#C9CFD6",
                borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13,
              }}>
                <Copy size={15} /> {copyConfirmed ? "Copied!" : "Copy Summary"}
              </button>
{canUseFinalReview && <button
  className="hg-btn"
  onClick={openFinalReview}
  style={{
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#B8894C",
    border: "none",
    color: "#14161A",
    borderRadius: 4,
    padding: "10px 18px",
    fontFamily: "'Oswald', sans-serif",
    fontWeight: 600,
    fontSize: 13
  }}
>
  <ChevronRight size={15} />
  Final Review
</button>}
<button
  className="hg-btn"
  onClick={clearOrder}
  style={{
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "none",
    border: "1px solid #6E7681",
    color: "#C9CFD6",
    borderRadius: 4,
    padding: "10px 18px",
    fontFamily: "'Oswald', sans-serif",
    fontWeight: 500,
    fontSize: 13
  }}
>
  <X size={15} />
  Clear Order
</button>
   
            </div>
          )}
        </div>
      ) : showCompare && compareIds.length >= 2 ? (
  // ---------- COMPARE VIEW ----------
  <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>

    <button
      className="hg-btn"
      onClick={() => setShowCompare(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: "none",
        border: "none",
        color: "#B8894C",
        fontFamily: "'Oswald', sans-serif",
        fontSize: 13,
        letterSpacing: 1,
        textTransform: "uppercase",
        padding: "6px 0",
        marginBottom: 18
      }}
    >
      <ArrowLeft size={16} /> Back to list
    </button>

    <div
      style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: 34,
        letterSpacing: 1,
        marginBottom: 4
      }}
    >
      Sales Comparison
    </div>

    <div
      style={{
        fontFamily: "'Oswald', sans-serif",
        fontSize: 12.5,
        color: "#8A93A0",
        letterSpacing: 0.8,
        marginBottom: 18
      }}
    >
      Compare product profile, pricing, and retailer economics side by side.
    </div>

    <div
      className="hg-scroll"
      style={{
        overflowX: "auto",
        border: "1px solid #3B2A1E",
        borderRadius: 8,
        background: "linear-gradient(180deg, #1d1712 0%, #171310 100%)"
      }}
    >
      <div
        style={{
          minWidth: compareIds.length === 3 ? 980 : 720,
          display: "grid",
          gridTemplateColumns: `170px repeat(${compareIds.length}, minmax(250px, 1fr))`
        }}
      >

        <div
          style={{
            padding: "18px 14px",
            borderBottom: "1px solid #3B2A1E",
            borderRight: "1px solid #3B2A1E"
          }}
        />

        {compareIds.map((id) => {
          const c = cigars.find((x) => x.id === id);
          if (!c) return null;

          return (
            <div
              key={`header-${id}`}
              style={{
                padding: "18px 16px",
                borderBottom: "1px solid #3B2A1E",
                borderRight: "1px solid #3B2A1E"
              }}
            >
              {c.line && (
                <div
                  style={{
                    fontFamily: "'Oswald', sans-serif",
                    fontSize: 10,
                    letterSpacing: 1.5,
                    color: "#B8894C",
                    textTransform: "uppercase"
                  }}
                >
                  {c.line}
                </div>
              )}

              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 28,
                  letterSpacing: 0.5,
                  marginTop: 2
                }}
              >
                {c.name}
              </div>
            </div>
          );
        })}

        {[
          {
            label: "Strength",
            render: (c) => `${c.strength || "—"}/5 · ${strengthWord(c.strength)}`
          },
          {
            label: "Body",
            render: (c) => `${c.body || "—"}/5`
          },
          {
            label: "Wrapper",
            render: (c) => c.wrapper || "—"
          },
          {
            label: "Binder",
            render: (c) => c.binder || "—"
          },
          {
            label: "Filler",
            render: (c) => c.filler || "—"
          },
          {
            label: "Origin",
            render: (c) => c.origin || "—"
          },
          {
            label: "Vitolas",
            render: (c) =>
              (c.sizes || [])
                .map((s) =>
                  `${s.vitola}${s.dims ? ` (${s.dims})` : ""}`
                )
                .join(", ") || "—"
          },
          {
            label: "MSRP Range",
            render: (c) => {
              const prices = (c.sizes || [])
                .map((s) => getNumericPrice(s, "msrp"))
                .filter((v) => typeof v === "number");

              if (!prices.length) return "—";

              const min = Math.min(...prices);
              const max = Math.max(...prices);

              return min === max
                ? `$${min.toFixed(2)}`
                : `$${min.toFixed(2)} – $${max.toFixed(2)}`;
            }
          },
          {
  label: "Best Retail Margin",
  render: (c) => {
    const allMargins = (c.sizes || [])
      .flatMap((s) =>
        (computePackageMargins(s) || []).map((m) => ({
          ...m,
          vitola: s.vitola
        }))
      );

    if (!allMargins.length) return "—";

    const best = allMargins.reduce((a, b) =>
      b.marginPct > a.marginPct ? b : a
    );

    return (
      <>
        <div>{best.marginPct.toFixed(1)}%</div>
        <div
          style={{
            fontSize: 10.5,
            color: "#8A93A0",
            marginTop: 3
          }}
        >
          {best.vitola} · {best.label}
        </div>
      </>
    );
  }
},
         {
  label: "Best Box / Bundle Profit",
  render: (c) => {
    const allMargins = (c.sizes || [])
      .flatMap((s) =>
        (computePackageMargins(s) || []).map((m) => ({
          ...m,
          vitola: s.vitola
        }))
      );

    if (!allMargins.length) return "—";

    const best = allMargins.reduce((a, b) =>
      b.grossProfit > a.grossProfit ? b : a
    );

    return (
      <>
        <div>${best.grossProfit.toFixed(2)}</div>

        <div
          style={{
            fontSize: 10.5,
            color: "#8A93A0",
            marginTop: 3
          }}
        >
          {best.vitola} · {best.label}
        </div>
      </>
    );
  }
},
          {
            label: "Tasting Notes",
            render: (c) =>
              (c.tastingNotes || []).join(", ") || "—"
          },
          {
            label: "Pairings",
            render: (c) =>
              (c.pairings || []).join(", ") || "—"
          }
        ].map((row) => (
          <React.Fragment key={row.label}>

            <div
              style={{
                padding: "13px 14px",
                borderBottom: "1px solid #2c3036",
                borderRight: "1px solid #3B2A1E",
                fontFamily: "'Oswald', sans-serif",
                fontSize: 10.5,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                color: "#8A93A0"
              }}
            >
              {row.label}
            </div>

            {compareIds.map((id) => {
              const c = cigars.find((x) => x.id === id);
              if (!c) return null;

              return (
                <div
                  key={`${row.label}-${id}`}
                  style={{
                    padding: "13px 16px",
                    borderBottom: "1px solid #2c3036",
                    borderRight: "1px solid #3B2A1E",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    color:
                      row.label.includes("Margin") ||
                      row.label.includes("Profit")
                        ? "#E7C79A"
                        : "#EDE6D6"
                  }}
                >
                  {row.render(c)}
                </div>
              );
            })}

          </React.Fragment>
        ))}
{canUseOrderBuilder && <div
  style={{
    padding: "14px",
    borderRight: "1px solid #3B2A1E",
    background: "rgba(184,137,76,0.04)"
  }}
>
  <div
    style={{
      fontFamily: "'Oswald', sans-serif",
      fontSize: 10.5,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      color: "#8A93A0"
    }}
  >
    Order
  </div>
</div>}

{canUseOrderBuilder && compareIds.map((id) => {
  const c = cigars.find((x) => x.id === id);
  if (!c) return null;

  return (
    <div
      key={`order-${id}`}
      style={{
        padding: "14px 16px",
        borderRight: "1px solid #3B2A1E",
        background: "rgba(184,137,76,0.04)"
      }}
    >
      <button
        type="button"
        className="hg-btn"
        onClick={() => openOrderFromCompare(c.id)}
        style={{
          width: "100%",
          background: "#B8894C",
          border: "none",
          color: "#14161A",
          borderRadius: 4,
          padding: "10px 14px",
          fontFamily: "'Oswald', sans-serif",
          fontWeight: 600,
          fontSize: 12.5,
          letterSpacing: 0.8,
          textTransform: "uppercase"
        }}
      >
        <ShoppingCart size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
        Build Order
      </button>
    </div>
  );
})}
      </div>
    </div>

    <div
      style={{
        marginTop: 14,
        fontFamily: "'Oswald', sans-serif",
        fontSize: 11.5,
        color: "#6E7681"
      }}
    >
      On smaller screens, swipe horizontally to view all selected cigars.
    </div>

  </div>
) : selected ? (
        // ---------- DETAIL VIEW ----------
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px" }}>
          <button className="hg-btn" onClick={() => setSelectedId(null)} style={{
            display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
            color: "#B8894C", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1,
            textTransform: "uppercase", padding: "6px 0", marginBottom: 18,
          }}>
            <ArrowLeft size={16} /> Back to list
          </button>

          <div style={{
            border: "1px solid #3B2A1E", borderRadius: 8, overflow: "hidden",
            background: "linear-gradient(180deg, #1d1712 0%, #171310 100%)",
          }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
              <div style={{
                width: 220, minHeight: 220, flex: "0 0 220px", background: "#0e0d0b",
                display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #3B2A1E",
              }}>
                {selected.imageUrl ? (
                  <img src={selected.imageUrl} alt={selected.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <Cigarette size={56} color="#454b53" />
                )}
              </div>
              <div style={{ flex: "1 1 300px", padding: "22px 24px" }}>
                {selected.line && (
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, letterSpacing: 2, color: "#B8894C", textTransform: "uppercase" }}>
                    {selected.line}
                  </div>
                )}
                <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 44, letterSpacing: 1, lineHeight: 1.05, margin: "2px 0 10px" }}>
                  {selected.name}
                </div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <Gauge value={selected.strength} label="Strength" />
                  <Gauge value={selected.body} label="Body" />
                </div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #3B2A1E", padding: "20px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
              {[
                ["Wrapper", selected.wrapper],
                ["Binder", selected.binder],
                ["Filler", selected.filler],
                ["Origin", selected.origin],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14.5, color: "#EDE6D6", marginTop: 2 }}>{val || "—"}</div>
                </div>
              ))}
            </div>

            <div style={{ borderTop: "1px solid #3B2A1E", padding: "20px 24px" }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase", marginBottom: 12 }}>Sizes & Pricing</div>
              {canUseOrderBuilder && <DetailOrderControls key={selected.id} cigar={selected} packOptions={PACK_OPTIONS} orderItems={orderItems} onAdd={addToOrder} onViewOrder={openOrderBuilder} />}
              {(selected.sizes || []).length === 0 ? (
                <div style={{ color: "#8A93A0", fontSize: 13.5, fontStyle: "italic" }}>No sizes on file.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {selected.sizes.map((s) => (
                    <div key={s.key} style={{ border: "1px solid #2c3036", borderRadius: 6, overflow: "hidden" }}>
                      <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "10px 14px", background: "rgba(184,137,76,0.07)", borderBottom: "1px solid #2c3036",
                      }}>
                        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 0.5, color: "#E7C79A" }}>
                          {s.vitola || "—"}{s.dims ? ` · ${s.dims}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                        <div style={{ padding: "12px 14px", borderRight: "1px solid #2c3036" }}>
                          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 6 }}>MSRP</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#B8894C" }}>{s.msrp || "—"}</div>
                        </div>
                        <div style={{ padding: "12px 14px" }}>
                          <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 6 }}>Keystone Pricing</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}>
                            <div><span style={{ color: "#8A93A0" }}>Single: </span>{s.keystoneSingle || "—"}</div>
                            <div><span style={{ color: "#8A93A0" }}>10ct Box: </span>{s.keystoneBox10 || "—"}</div>
                            <div><span style={{ color: "#8A93A0" }}>20ct Box: </span>{s.keystoneBox20 || "—"}</div>
                            <div><span style={{ color: "#8A93A0" }}>20ct Bundle: </span>{s.keystoneBundle20 || "—"}</div>
                          </div>
                         {(() => {
  const margins = computePackageMargins(s);

  if (!margins) return null;

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px dashed #3B2A1E"
      }}
    >
      <div
        style={{
          fontFamily: "'Oswald', sans-serif",
          fontSize: 10,
          letterSpacing: 1.5,
          color: "#8A93A0",
          textTransform: "uppercase",
          marginBottom: 7
        }}
      >
        Retailer Profit
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8
        }}
      >
        {margins.map((m) => (
          <div
            key={m.key}
            style={{
              borderLeft: "2px solid #B8894C",
              paddingLeft: 8
            }}
          >
            <div
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontSize: 11,
                letterSpacing: 1,
                color: "#C9CFD6",
                textTransform: "uppercase"
              }}
            >
              {m.label}
            </div>

            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12.5,
                color: "#E7C79A",
                marginTop: 2
              }}
            >
              ${m.grossProfit.toFixed(2)} profit ·{" "}
              {m.marginPct.toFixed(1)}% margin
            </div>

            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11.5,
                color: "#8A93A0",
                marginTop: 2
              }}
            >
              Cost ${m.cost.toFixed(2)} · Retail $
              {m.retailValue.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
})()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid #3B2A1E", padding: "20px 24px" }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase", marginBottom: 8 }}>Tasting Notes</div>
              {(selected.tastingNotes || []).length ? (selected.tastingNotes || []).map((n, i) => <Tag key={i} tone="brass">{n}</Tag>) : <div style={{ color: "#8A93A0", fontSize: 13.5, fontStyle: "italic" }}>None on file.</div>}
            </div>

            <div style={{ borderTop: "1px solid #3B2A1E", padding: "20px 24px" }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase", marginBottom: 8 }}>Pairing Suggestions</div>
              {(selected.pairings || []).length ? (selected.pairings || []).map((n, i) => <Tag key={i} tone="steel">{n}</Tag>) : <div style={{ color: "#8A93A0", fontSize: 13.5, fontStyle: "italic" }}>None on file.</div>}
            </div>

            {selected.notes && (
              <div style={{ borderTop: "1px solid #3B2A1E", padding: "20px 24px" }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase", marginBottom: 8 }}>Notes</div>
                <div style={{ fontStyle: "italic", color: "#C9CFD6", fontSize: 14.5, lineHeight: 1.5 }}>{selected.notes}</div>
              </div>
            )}

            <div style={{
              borderTop: "1px solid #3B2A1E", padding: "18px 24px", display: "flex",
              justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 12,
              background: "rgba(184,137,76,0.06)",
            }}>
              {canEditCatalog ? (
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="hg-btn" onClick={() => openEdit(selected)} style={{
                    display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #6E7681",
                    color: "#C9CFD6", borderRadius: 4, padding: "8px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 12.5,
                  }}><Pencil size={14} /> Edit</button>
                  <button className="hg-btn" onClick={() => setConfirmDeleteId(selected.id)} style={{
                    display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #A8402E",
                    color: "#d98a7c", borderRadius: 4, padding: "8px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 12.5,
                  }}><Trash2 size={14} /> Delete</button>
                </div>
              ) : (
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, color: "#5c636b", fontStyle: "italic" }}>
                  {user ? "Catalog editing is not available for this account" : "Sign in to edit this card"}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        // ---------- LIST VIEW ----------
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "20px 24px" }}>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search size={16} color="#8A93A0" style={{ position: "absolute", left: 12, top: 12 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, wrapper, vitola, tasting note…"
              style={{
                width: "100%", background: "#1c1f24", border: "1px solid #454b53", borderRadius: 5,
                padding: "10px 12px 10px 36px", color: "#EDE6D6", fontSize: 14,
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <select
              value={strengthFilter}
              onChange={(e) => setStrengthFilter(e.target.value)}
              style={{
                background: "#1c1f24", border: "1px solid #454b53", borderRadius: 5, color: "#C9CFD6",
                fontFamily: "'Oswald', sans-serif", fontSize: 12.5, padding: "8px 10px",
              }}
            >
              <option value="all">All Strengths</option>
              <option value="1">Mild</option>
              <option value="2">Mild-Medium</option>
              <option value="3">Medium</option>
              <option value="4">Medium-Full</option>
              <option value="5">Full</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                background: "#1c1f24", border: "1px solid #454b53", borderRadius: 5, color: "#C9CFD6",
                fontFamily: "'Oswald', sans-serif", fontSize: 12.5, padding: "8px 10px",
              }}
            >
              <option value="name">Sort: Name (A–Z)</option>
              <option value="strength-asc">Sort: Strength (Mild → Full)</option>
              <option value="strength-desc">Sort: Strength (Full → Mild)</option>
              <option value="body-asc">Sort: Body (Light → Full)</option>
              <option value="body-desc">Sort: Body (Full → Light)</option>
            </select>
            <button
              type="button"
              className="hg-btn"
              onClick={() => setCompareMode((m) => !m)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: compareMode ? "#B8894C" : "none",
                color: compareMode ? "#14161A" : "#C9CFD6",
                border: compareMode ? "1px solid #B8894C" : "1px solid #6E7681",
                borderRadius: 5, padding: "8px 14px", fontFamily: "'Oswald', sans-serif",
                fontSize: 12.5, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase",
              }}
            >
              <Scale size={14} /> {compareMode ? "Cancel Compare" : "Compare"}
            </button>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#8A93A0", fontFamily: "'Oswald', sans-serif" }}>
              {cigars.length === 0 ? "No cigars logged yet. Add your first one." : "No matches for that search."}
            </div>
          ) : (
            <div className="hg-scroll" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {groupedFiltered.map((group) => (
                <React.Fragment key={group.name}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, margin: "14px 0 2px",
                  }}>
                    <div style={{
                      fontFamily: "'Oswald', sans-serif", fontSize: 12.5, letterSpacing: 2, color: "#B8894C",
                      textTransform: "uppercase", whiteSpace: "nowrap",
                    }}>{group.name}</div>
                    <div style={{ flex: 1, height: 1, background: "#2c3036" }} />
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#5c636b" }}>{group.items.length}</div>
                  </div>
                  {group.items.map((c) => {
                    const isChecked = compareIds.includes(c.id);
                    return (
                <div key={c.id} className="hg-row" onClick={() => (compareMode ? toggleCompareId(c.id) : setSelectedId(c.id))} style={{
                  display: "flex", alignItems: "center", gap: 16, cursor: "pointer",
                  border: isChecked ? "1px solid #B8894C" : "1px solid #2c3036", borderRadius: 6, padding: "12px 16px",
                  background: isChecked ? "rgba(184,137,76,0.08)" : "rgba(255,255,255,0.015)", transition: "background 0.15s, border-color 0.15s",
                }}>
                  {compareMode ? (
                    <div style={{
                      width: 20, height: 20, flex: "0 0 20px", borderRadius: 4,
                      border: isChecked ? "none" : "1px solid #6E7681",
                      background: isChecked ? "#B8894C" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isChecked && <span style={{ color: "#14161A", fontSize: 13, fontWeight: 700 }}>✓</span>}
                    </div>
                  ) : (
                    <Cigarette size={16} color="#454b53" style={{ flex: "0 0 16px" }} />
                  )}
                  <div style={{
                    width: 44, height: 44, borderRadius: 4, background: "#0e0d0b", flex: "0 0 44px",
                    display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                    border: "1px solid #3B2A1E",
                  }}>
                    {c.imageUrl ? <img src={c.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Cigarette size={20} color="#454b53" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 0.5, lineHeight: 1.1 }}>{c.name}</div>
                    <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12, color: "#8A93A0", letterSpacing: 0.5 }}>
                      {sizeSummary(c)} · {c.wrapper}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
                    color: "#E7C79A", border: "1px solid #B8894C", borderRadius: 3, padding: "3px 8px", whiteSpace: "nowrap",
                  }}>{strengthWord(c.strength)}</div>
                  {!compareMode && <ChevronRight size={18} color="#454b53" />}
                </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          )}

          {compareMode && compareIds.length >= 2 && (
            <div style={{
              position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
              background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8,
              padding: "14px 20px", display: "flex", alignItems: "center", gap: 16,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 40,
            }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, color: "#EDE6D6" }}>
               {compareIds.length} cigars selected
              </div>
              <button className="hg-btn" onClick={() => setShowCompare(true)} style={{
                background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4,
                padding: "8px 16px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 12.5,
              }}>
                Compare →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---------- ADD/EDIT FORM MODAL ---------- */}
      {formOpen && canEditCatalog && canEditPackages && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50,
        }} onClick={() => setFormOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="hg-scroll" style={{
            background: "#1c1f24", border: "1px solid #454b53", borderRadius: 8, width: "100%",
            maxWidth: 560, maxHeight: "88vh", overflowY: "auto", padding: 24,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1 }}>
                {editingId ? "Edit Cigar" : "Add Cigar"}
              </div>
              <button className="hg-btn" onClick={() => setFormOpen(false)} style={{ background: "none", border: "none", color: "#8A93A0" }}>
                <X size={20} />
              </button>
            </div>

            {[
              ["name", "Name"], ["line", "Line / Series"],
            ].map(([key, label]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>{label}</label>
                <input
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }}
                />
              </div>
            ))}

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>Photo</label>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6 }}>
                <div style={{
                  width: 64, height: 64, flex: "0 0 64px", borderRadius: 4, background: "#0e0d0b",
                  border: "1px solid #3B2A1E", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                }}>
                  {uploading ? (
                    <Loader2 size={20} color="#B8894C" className="hg-spin" />
                  ) : form.imageUrl ? (
                    <img src={form.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <Cigarette size={22} color="#454b53" />
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handlePhotoFile(e.target.files && e.target.files[0])}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    className="hg-btn"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    style={{
                      display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #6E7681",
                      color: "#C9CFD6", borderRadius: 4, padding: "7px 12px", fontFamily: "'Oswald', sans-serif", fontSize: 12.5,
                    }}
                  >
                    <Upload size={14} /> {form.imageUrl ? "Replace photo" : "Upload photo"}
                  </button>
                  {form.imageUrl && (
                    <button
                      type="button"
                      className="hg-btn"
                      onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))}
                      style={{
                        background: "none", border: "none", color: "#8A93A0", fontFamily: "'Oswald', sans-serif",
                        fontSize: 12, marginLeft: 10, textDecoration: "underline",
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              {uploadError && <div style={{ color: "#d98a7c", fontSize: 12, marginTop: 6, fontFamily: "'Oswald', sans-serif" }}>{uploadError}</div>}
              <div style={{ marginTop: 8 }}>
                <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1, color: "#5c636b", textTransform: "uppercase" }}>Or paste an image URL</label>
                <input
                  value={form.imageUrl && form.imageUrl.startsWith("data:") ? "" : form.imageUrl}
                  placeholder={form.imageUrl && form.imageUrl.startsWith("data:") ? "Uploaded photo in use" : ""}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }}
                />
              </div>
            </div>

            {[
              ["wrapper", "Wrapper"], ["binder", "Binder"], ["filler", "Filler"], ["origin", "Origin"],
            ].map(([key, label]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>{label}</label>
                <input
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }}
                />
              </div>
            ))}

            <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              {["strength", "body"].map((key) => (
                <div key={key} style={{ flex: 1 }}>
                  <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>
                    {key === "strength" ? "Strength (1–5)" : "Body (1–5)"}
                  </label>
                  <input
                    type="number" min={1} max={5}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }}
                  />
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>Sizes & Pricing</label>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 12 }}>
                {form.sizes.map((s, idx) => (
                  <div key={s.key} style={{ border: "1px solid #3B2A1E", borderRadius: 5, padding: 10, position: "relative" }}>
                    {form.sizes.length > 1 && (
                      <button
                        type="button"
                        className="hg-btn"
                        onClick={() => removeSizeRow(idx)}
                        style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", color: "#8A93A0" }}
                      >
                        <X size={14} />
                      </button>
                    )}
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        placeholder="Vitola (e.g. Toro)"
                        value={s.vitola}
                        onChange={(e) => setSizeField(idx, "vitola", e.target.value)}
                        style={{ flex: 1, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "7px 9px", color: "#EDE6D6", fontSize: 13.5 }}
                      />
                      <input
                        placeholder="Size (e.g. 52 x 6)"
                        value={s.dims}
                        onChange={(e) => setSizeField(idx, "dims", e.target.value)}
                        style={{ flex: 1, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "7px 9px", color: "#EDE6D6", fontSize: 13.5 }}
                      />
                    </div>

                    <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: 1, color: "#8A93A0", textTransform: "uppercase" }}>MSRP</label>
                    <input
                      placeholder="Suggested retail price"
                      value={s.msrp}
                      onChange={(e) => setSizeField(idx, "msrp", e.target.value)}
                      style={{ width: "100%", marginTop: 3, marginBottom: 8, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "7px 9px", color: "#EDE6D6", fontSize: 13.5 }}
                    />

                    <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: 1, color: "#8A93A0", textTransform: "uppercase" }}>Keystone Pricing</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 3 }}>
                      <input
                        placeholder="Single unit cost (e.g. $6.45 box / $6.20 bundle)"
                        value={s.keystoneSingle}
                        onChange={(e) => setSizeField(idx, "keystoneSingle", e.target.value)}
                        style={{ background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "7px 9px", color: "#EDE6D6", fontSize: 13.5 }}
                      />
                      <input
                        placeholder="10ct Box price"
                        value={s.keystoneBox10}
                        onChange={(e) => setSizeField(idx, "keystoneBox10", e.target.value)}
                        style={{ background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "7px 9px", color: "#EDE6D6", fontSize: 13.5 }}
                      />
                      <input
                        placeholder="20ct Box price"
                        value={s.keystoneBox20}
                        onChange={(e) => setSizeField(idx, "keystoneBox20", e.target.value)}
                        style={{ background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "7px 9px", color: "#EDE6D6", fontSize: 13.5 }}
                      />
                      <input
                        placeholder="20ct Bundle price"
                        value={s.keystoneBundle20}
                        onChange={(e) => setSizeField(idx, "keystoneBundle20", e.target.value)}
                        style={{ background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "7px 9px", color: "#EDE6D6", fontSize: 13.5 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="hg-btn"
                onClick={addSizeRow}
                style={{
                  display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px dashed #6E7681",
                  color: "#C9CFD6", borderRadius: 4, padding: "8px 12px", fontFamily: "'Oswald', sans-serif", fontSize: 12.5,
                  marginTop: 8, width: "100%", justifyContent: "center",
                }}
              >
                <Plus size={14} /> Add another size
              </button>
            </div>

            {[
              ["tastingNotes", "Tasting Notes (comma-separated)"],
              ["pairings", "Pairing Suggestions (comma-separated)"],
            ].map(([key, label]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>{label}</label>
                <input
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  placeholder="e.g. cedar, black pepper, cocoa"
                  style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }}
                />
              </div>
            ))}

            <div style={{ marginBottom: 18 }}>
              <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>Construction / Burn Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14, resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="hg-btn" onClick={() => setFormOpen(false)} style={{
                background: "none", border: "1px solid #454b53", color: "#C9CFD6", borderRadius: 4,
                padding: "9px 16px", fontFamily: "'Oswald', sans-serif", fontSize: 13,
              }}>Cancel</button>
              <button className="hg-btn" onClick={saveForm} style={{
                background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4,
                padding: "9px 16px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 13,
              }}>{editingId ? "Save Changes" : "Add Cigar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- SIGN IN MODAL ---------- */}
      {signInOpen && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 20, zIndex: 70,
        }} onClick={() => setSignInOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#1c1f24", border: "1px solid #454b53", borderRadius: 8, padding: 24, width: "100%", maxWidth: 360,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1 }}>Sign In</div>
              <button className="hg-btn" onClick={() => setSignInOpen(false)} style={{ background: "none", border: "none", color: "#8A93A0" }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>Email</label>
              <input
                type="email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" }}>Password</label>
              <input
                type="password"
                value={signInPassword}
                onChange={(e) => setSignInPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSignIn(); }}
                style={{ width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 }}
              />
            </div>
            {signInError && <div style={{ color: "#d98a7c", fontSize: 12.5, marginBottom: 12, fontFamily: "'Oswald', sans-serif" }}>{signInError}</div>}
            <button className="hg-btn" onClick={handleSignIn} disabled={signingIn} style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4,
              padding: "10px 16px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 13,
            }}>
              {signingIn ? <Loader2 size={16} className="hg-spin" /> : "Sign In"}
            </button>
          </div>
        </div>
      )}

      {/* ---------- DELETE CONFIRM ---------- */}
      {confirmDeleteId && canEditCatalog && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60,
        }} onClick={() => setConfirmDeleteId(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#1c1f24", border: "1px solid #A8402E", borderRadius: 8, padding: 22, maxWidth: 360,
          }}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, marginBottom: 16 }}>
              Delete this cigar from the reference list? This can't be undone.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="hg-btn" onClick={() => setConfirmDeleteId(null)} style={{
                background: "none", border: "1px solid #454b53", color: "#C9CFD6", borderRadius: 4, padding: "8px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 13,
              }}>Cancel</button>
              <button className="hg-btn" onClick={() => doDelete(confirmDeleteId)} style={{
                background: "#A8402E", border: "none", color: "#EDE6D6", borderRadius: 4, padding: "8px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 13,
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const rootEl = document.getElementById("root");
createRoot(rootEl).render(<HazeGrayReference />);
