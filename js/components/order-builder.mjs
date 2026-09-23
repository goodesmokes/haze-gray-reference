import React from "react";
import { ArrowLeft, ChevronRight, Copy, Mail, Minus, Plus, X } from "lucide-react";
import { getNumericPrice, getSinglePrice } from "../domain/pricing.mjs";
import { userButtonStyle, userFieldStyle } from "../ui/styles.mjs";

const h = React.createElement;

const sectionLabelStyle = { fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 10 };
const fieldLabelStyle = { fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" };
const fieldStyle = { width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 };
const metricLabelStyle = { fontFamily: "'Oswald', sans-serif", fontSize: 9.5, letterSpacing: 1.2, color: "#8A93A0", textTransform: "uppercase" };
const totalLabelStyle = { fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: 1.3, color: "#8A93A0", textTransform: "uppercase" };

function Metric({ label, value, accent = false }) {
  return h("div", null,
    h("div", { style: metricLabelStyle }, label),
    h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: accent ? "#B8894C" : "#EDE6D6", marginTop: 2 } }, value)
  );
}

function Total({ label, value, accent = false }) {
  return h("div", null,
    h("div", { style: totalLabelStyle }, label),
    h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: accent ? "#B8894C" : "#EDE6D6", marginTop: 3 } }, value)
  );
}

export function OrderBuilder({
  draft,
  directory,
  cigars,
  packOptions,
  compareOrderId,
  orderWholesaleTotal,
  orderRetailTotal,
  orderGrossProfit,
  orderMarginPct,
  canUseFinalReview,
  copyConfirmed,
  requirePermission,
  onClose,
  onSelectRetailer,
  onRetailerNameChange,
  onRetailerEmailChange,
  onNotesChange,
  onAdd,
  onSetQuantity,
  onRemove,
  onEmail,
  onCopy,
  onFinalReview,
  onClear
}) {
  const { retailerId, orderRetailer, orderEmail, orderNotes, orderItems } = draft;
  const activeRetailers = directory.records.filter((item) => item.active);
  const linkedRetailerAvailable = directory.records.some((item) => item.id === retailerId && item.active);

  return h("div", { style: { maxWidth: 900, margin: "0 auto", padding: "24px" } },
    h("button", { className: "hg-btn", onClick: onClose, style: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#B8894C", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", padding: "6px 0", marginBottom: 18 } }, h(ArrowLeft, { size: 16 }), " Back to list"),
    h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 1, marginBottom: 16 } }, "Order Builder"),
    h("div", { style: { border: "1px solid #2c3036", borderRadius: 8, padding: "16px 18px", marginBottom: 20 } },
      h("label", null, "Select Existing Retailer or Manual Entry",
        h("select", { "aria-label": "Order retailer", value: retailerId, onChange: (event) => onSelectRetailer(event.target.value), style: { ...userFieldStyle, marginBottom: 12 } },
          h("option", { value: "" }, "One-time / Manual Retailer"),
          retailerId && !linkedRetailerAvailable && h("option", { value: retailerId }, "Linked retailer unavailable"),
          activeRetailers.map((item) => h("option", { key: item.id, value: item.id }, item.name))
        )
      ),
      directory.error && h("p", { role: "alert" }, directory.error, " ", h("button", { className: "hg-btn", style: userButtonStyle, onClick: directory.reload }, "Reload Retailers")),
      retailerId && directory.ready && !linkedRetailerAvailable && h("p", { role: "alert", style: { color: "#d98a7c" } }, "The linked retailer is inactive or unavailable. Your captured name/email are preserved. Select another retailer or switch to manual entry."),
      retailerId && h("p", null, "Linked retailer snapshot. Switch to manual entry to edit name/email. Customer notes are not copied into order notes."),
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 } },
        h("div", null,
          h("label", { style: fieldLabelStyle }, "Retailer Name"),
          h("input", { disabled: Boolean(retailerId), value: orderRetailer, onChange: (event) => { if (requirePermission("canUseOrderBuilder")) onRetailerNameChange(event.target.value); }, style: fieldStyle })
        ),
        h("div", null,
          h("label", { style: fieldLabelStyle }, "Retailer Contact Email"),
          h("input", { disabled: Boolean(retailerId), value: orderEmail, onChange: (event) => { if (requirePermission("canUseOrderBuilder")) onRetailerEmailChange(event.target.value); }, style: fieldStyle })
        )
      ),
      h("label", { style: fieldLabelStyle }, "Notes"),
      h("textarea", { value: orderNotes, onChange: (event) => { if (requirePermission("canUseOrderBuilder")) onNotesChange(event.target.value); }, rows: 2, style: { ...fieldStyle, resize: "vertical" } })
    ),
    h("div", { style: sectionLabelStyle }, "Add Cigars"),
    h("div", { style: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 } },
      cigars.map((cigar) => h("div", { key: cigar.id, id: `order-cigar-${cigar.id}`, style: { border: compareOrderId === cigar.id ? "1px solid #B8894C" : "1px solid #2c3036", borderRadius: 6, padding: "12px 14px", background: compareOrderId === cigar.id ? "rgba(184,137,76,0.06)" : "transparent" } },
        h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 0.5, marginBottom: 8 } }, cigar.name),
        (cigar.sizes || []).length === 0
          ? h("div", { style: { color: "#5c636b", fontSize: 12.5, fontStyle: "italic" } }, "No sizes on file.")
          : h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, cigar.sizes.map((size) => h("div", { key: size.key, style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
              h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#C9CFD6", minWidth: 140 } }, size.vitola, size.dims ? ` (${size.dims})` : ""),
              packOptions.map((pack) => {
                const price = pack.key === "single" ? getSinglePrice(size, "box") : getNumericPrice(size, pack.key);
                if (price == null) return null;
                return h("button", { key: pack.key, type: "button", className: "hg-btn", onClick: () => onAdd(cigar, size, pack.key), style: { background: "none", border: "1px solid #454b53", color: "#C9CFD6", borderRadius: 4, padding: "5px 10px", fontFamily: "'Oswald', sans-serif", fontSize: 11.5 } }, `+ ${pack.label} ($${price.toFixed(2)})`);
              })
            )))
      ))
    ),
    h("div", { style: sectionLabelStyle }, "Order Summary"),
    orderItems.length === 0
      ? h("div", { style: { color: "#5c636b", fontSize: 13.5, fontStyle: "italic", marginBottom: 20 } }, "No items added yet — use the buttons above.")
      : h("div", { style: { border: "1px solid #2c3036", borderRadius: 8, overflow: "hidden", marginBottom: 20 } },
          orderItems.map((line) => {
            const lineWholesale = line.unitPrice * line.qty;
            const lineRetail = typeof line.retailUnitValue === "number" ? line.retailUnitValue * line.qty : 0;
            const lineProfit = lineRetail - lineWholesale;
            const lineMargin = lineRetail > 0 ? (lineProfit / lineRetail) * 100 : 0;
            return h("div", { key: line.lineKey, style: { padding: "12px 14px", borderBottom: "1px solid #2c3036" } },
              h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
                h("div", { style: { flex: 1, minWidth: 180, fontFamily: "'Oswald', sans-serif", fontSize: 13, color: "#EDE6D6" } }, line.cigarName, " — ", line.vitola, line.dims ? ` (${line.dims})` : "", " — ", line.packLabel),
                h("button", { className: "hg-btn", onClick: () => onSetQuantity(line.lineKey, line.qty - 1), style: { background: "none", border: "1px solid #454b53", color: "#C9CFD6", borderRadius: 4, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" } }, h(Minus, { size: 12 })),
                h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#EDE6D6", minWidth: 22, textAlign: "center" } }, line.qty),
                h("button", { className: "hg-btn", onClick: () => onSetQuantity(line.lineKey, line.qty + 1), style: { background: "none", border: "1px solid #454b53", color: "#C9CFD6", borderRadius: 4, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" } }, h(Plus, { size: 12 })),
                h("button", { className: "hg-btn", onClick: () => onRemove(line.lineKey), style: { background: "none", border: "none", color: "#8A93A0" } }, h(X, { size: 16 }))
              ),
              h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(69,75,83,0.45)" } },
                h(Metric, { label: "Wholesale", value: `$${lineWholesale.toFixed(2)}` }),
                h(Metric, { label: "Retail Value", value: `$${lineRetail.toFixed(2)}` }),
                h(Metric, { label: "Gross Profit", value: `$${lineProfit.toFixed(2)}`, accent: true }),
                h(Metric, { label: "Margin", value: `${lineMargin.toFixed(1)}%`, accent: true })
              )
            );
          }),
          h("div", { style: { padding: "12px 14px 6px", fontFamily: "'Oswald', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: 1.6, color: "#B8894C", textTransform: "uppercase" } }, "Order Totals"),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, padding: "14px", background: "rgba(184,137,76,0.06)" } },
            h(Total, { label: "Wholesale", value: `$${orderWholesaleTotal.toFixed(2)}` }),
            h(Total, { label: "Retail Value", value: `$${orderRetailTotal.toFixed(2)}` }),
            h(Total, { label: "Gross Profit", value: `$${orderGrossProfit.toFixed(2)}`, accent: true }),
            h(Total, { label: "Margin", value: `${orderMarginPct.toFixed(1)}%`, accent: true })
          )
        ),
    orderItems.length > 0 && h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
      h("button", { className: "hg-btn", onClick: onEmail, style: { display: "flex", alignItems: "center", gap: 8, background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 13 } }, h(Mail, { size: 15 }), " Email Summary"),
      h("button", { className: "hg-btn", onClick: onCopy, style: { display: "flex", alignItems: "center", gap: 8, background: "none", border: "1px solid #6E7681", color: "#C9CFD6", borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13 } }, h(Copy, { size: 15 }), " ", copyConfirmed ? "Copied!" : "Copy Summary"),
      canUseFinalReview && h("button", { className: "hg-btn", onClick: onFinalReview, style: { display: "flex", alignItems: "center", gap: 8, background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 13 } }, h(ChevronRight, { size: 15 }), " Final Review"),
      h("button", { className: "hg-btn", onClick: onClear, style: { display: "flex", alignItems: "center", gap: 8, background: "none", border: "1px solid #6E7681", color: "#C9CFD6", borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13 } }, h(X, { size: 15 }), " Clear Order")
    )
  );
}
