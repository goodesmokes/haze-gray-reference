import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { getProfilePermissions } from "../domain/authorization.mjs";
import { normalizeRetailerName, validRetailerId } from "../domain/retailers.mjs";
import { buildReorderPlan } from "../domain/saved-orders.mjs";
import { subscribeOrderHistory } from "../services/order-service.mjs";
import { userButtonStyle, userFieldStyle } from "../ui/styles.mjs";

const h = React.createElement;
const orderMoney = (value) => Number.isFinite(value) ? `$${value.toFixed(2)}` : "Not recorded";
const savedOrderDate = (value) => value?.toDate ? value.toDate().toLocaleString() : "Date unavailable";

export function OrderHistory({ user, profile, cigars, packOptions, draft, requirePermission, onApplyReorder, onClose, retailerFilter = null, onOpenRetailer }) {
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
    }, (error) => {
      if (!active) return;
      setOrders([]); setSelectedOrderId(null); setReview(false); setReady(true);
      setHistoryError(`Could not load order history: ${error.message}`);
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
    try { onApplyReorder(selected, plan, mode); } catch (error) { setHistoryError(error.message); }
  };

  const back = h("button", {
    className: "hg-btn", style: userButtonStyle,
    onClick: selected ? () => { setSelectedOrderId(null); setReview(false); } : onClose
  }, h(ArrowLeft, { size: 14 }), " ", selected ? "Back to History" : "Back to list");

  const historyList = h(React.Fragment, null,
    h("input", { "aria-label": "Search retailer history", placeholder: "Search retailer name…", value: search, onChange: (event) => setSearch(event.target.value), style: { ...userFieldStyle, margin: "12px 0" } }),
    !ready ? h("p", null, "Loading saved orders…")
      : !orders.length ? h("p", null, "No saved orders yet.")
        : !filtered.length ? h("p", null, "No orders match this retailer search.")
          : h(React.Fragment, null,
              h("p", { style: { color: "#8A93A0", fontSize: 13 } }, filtered.length, " saved orders · Most recent: ", savedOrderDate(filtered[0].savedAt)),
              filtered.map((order) => h("button", {
                key: order.id, className: "hg-btn",
                onClick: () => { if (requirePermission("canUseOrderBuilder")) setSelectedOrderId(order.id); },
                style: { ...userButtonStyle, width: "100%", textAlign: "left", display: "block", marginBottom: 10, padding: 16 }
              },
              h("strong", null, order.retailerName || "Retailer not recorded"), " · ", orderMoney(order.totals?.wholesaleTotal),
              h("div", { style: { marginTop: 6, color: "#8A93A0" } }, savedOrderDate(order.savedAt), " · ", order.totals?.totalQuantity ?? "—", " total quantity · ", order.lineItems?.length ?? "—", " lines", order.creatorDisplayName ? ` · ${order.creatorDisplayName}` : "")
              ))
            )
  );

  const reviewDialog = review && h("div", { role: "dialog", "aria-modal": "true", "aria-label": "Review reorder", style: { position: "fixed", inset: 0, zIndex: 65, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } },
    h("div", { className: "hg-scroll", style: { background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: 20, width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto" } },
      h("h2", { style: { fontFamily: "'Bebas Neue', sans-serif" } }, "Review Reorder"),
      historyError && h("p", { role: "alert", style: { color: "#d98a7c" } }, historyError),
      h("p", null, "New order items use current prices. The historical order remains unchanged."),
      plan.available.map(({ line, historicalPrice, activePrice }, index) => h("div", { key: index, style: { borderBottom: "1px solid #454b53", padding: "10px 0" } },
        line.cigarName, " · ", line.vitola, " · ", line.packLabel, " × ", line.qty,
        h("div", null, "Historical: ", orderMoney(historicalPrice), " → Current: ", orderMoney(line.unitPrice)),
        activePrice !== undefined && h("div", { style: { color: "#B8894C" } }, "Matching active line: ", orderMoney(activePrice), " → ", orderMoney(line.unitPrice), ". Add mode combines quantities and reprices the combined line.")
      )),
      plan.unavailable.length > 0 && h("div", { style: { color: "#d98a7c", marginTop: 14 } },
        plan.unavailable.map((line, index) => h("p", { key: index }, line.cigarName, " · ", line.vitola, " · ", line.packLabel, ": ", line.reason)),
        h("label", null, h("input", { type: "checkbox", checked: acknowledged, onChange: (event) => setAcknowledged(event.target.checked) }), " I understand these items will not be added.")
      ),
      hasDraft && h("p", null, "Replace copies the saved retailer, email, notes and available items into your draft. Add keeps your current retailer, email and notes; only matching lines are repriced. Unrelated lines stay unchanged."),
      !plan.available.length && h("p", null, "No configurations are currently available to reorder."),
      h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 } },
        h("button", { className: "hg-btn", style: userButtonStyle, disabled: !plan.available.length || (plan.unavailable.length > 0 && !acknowledged), onClick: () => apply("replace") }, hasDraft ? "Replace Current Order" : "Create Active Order"),
        hasDraft && h("button", { className: "hg-btn", style: userButtonStyle, disabled: !plan.available.length || (plan.unavailable.length > 0 && !acknowledged), onClick: () => apply("add") }, "Add Items to Current Order"),
        h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => setReview(false) }, "Cancel")
      )
    )
  );

  const selectedOrder = selected && h(React.Fragment, null,
    h("h2", { style: { fontFamily: "'Oswald', sans-serif" } }, selected.retailerName || "Retailer not recorded"),
    validRetailerId(selected.retailerId) && onOpenRetailer && h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => onOpenRetailer(selected.retailerId) }, "Open Retailer Profile"),
    h("p", null, savedOrderDate(selected.savedAt), selected.creatorDisplayName ? ` · ${selected.creatorDisplayName}` : ""),
    h("p", { style: { color: "#8A93A0", overflowWrap: "anywhere" } }, "Order ", selected.id),
    selected.retailerEmail && h("p", null, selected.retailerEmail),
    selected.notes && h("p", { style: { whiteSpace: "pre-wrap" } }, selected.notes),
    (selected.lineItems || []).map((line, index) => h("div", { key: index, style: { border: "1px solid #3B2A1E", borderRadius: 6, padding: 14, marginBottom: 10 } },
      h("strong", null, line.cigarName || "Product not recorded"), " · ", line.vitola, " ", line.dims, " · ", line.packLabel,
      h("div", { style: { marginTop: 8 } }, line.qty, " × ", orderMoney(line.unitPrice), " · Historical line total: ", orderMoney(line.wholesaleTotal))
    )),
    h("p", null, "Historical order total: ", h("strong", null, orderMoney(selected.totals?.wholesaleTotal))),
    h("p", { style: { color: "#8A93A0" } }, "Retail value: ", orderMoney(selected.totals?.retailTotal), " · Gross profit: ", orderMoney(selected.totals?.grossProfit), " · Margin: ", Number.isFinite(selected.totals?.marginPct) ? `${selected.totals.marginPct.toFixed(1)}%` : "Not recorded"),
    h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => { if (requirePermission("canUseOrderBuilder")) { setReview(true); setAcknowledged(false); } } }, "Start New Order From This"),
    reviewDialog
  );

  return h("div", { style: { maxWidth: 1000, margin: "0 auto", padding: 24 } },
    back,
    h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, marginTop: 16 } }, "Order History"),
    historyError && h("div", { role: "alert", style: { color: "#d98a7c", margin: "12px 0" } }, historyError, " ", h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => setRetry((value) => value + 1) }, "Reload history")),
    retailerFilter && h("p", null, "Showing exact retailer-linked orders you are permitted to read. Older unlinked orders are not included."),
    selected ? selectedOrder : historyList
  );
}
