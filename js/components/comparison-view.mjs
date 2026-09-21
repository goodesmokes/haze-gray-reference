import React from "react";
import { ArrowLeft, ShoppingCart } from "lucide-react";
import { computePackageMargins, getNumericPrice } from "../domain/pricing.mjs";

const h = React.createElement;

export function ComparisonView({ compareIds, cigars, canUseOrderBuilder, strengthWord, onClose, onBuildOrder }) {
  const rows = [
    { label: "Strength", render: (c) => `${c.strength || "—"}/5 · ${strengthWord(c.strength)}` },
    { label: "Body", render: (c) => `${c.body || "—"}/5` },
    { label: "Wrapper", render: (c) => c.wrapper || "—" },
    { label: "Binder", render: (c) => c.binder || "—" },
    { label: "Filler", render: (c) => c.filler || "—" },
    { label: "Origin", render: (c) => c.origin || "—" },
    { label: "Vitolas", render: (c) => (c.sizes || []).map((s) => `${s.vitola}${s.dims ? ` (${s.dims})` : ""}`).join(", ") || "—" },
    {
      label: "MSRP Range",
      render: (c) => {
        const prices = (c.sizes || []).map((s) => getNumericPrice(s, "msrp")).filter((v) => typeof v === "number");
        if (!prices.length) return "—";
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        return min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)} – $${max.toFixed(2)}`;
      }
    },
    {
      label: "Best Retail Margin",
      render: (c) => {
        const allMargins = (c.sizes || []).flatMap((s) => (computePackageMargins(s) || []).map((m) => ({ ...m, vitola: s.vitola })));
        if (!allMargins.length) return "—";
        const best = allMargins.reduce((a, b) => b.marginPct > a.marginPct ? b : a);
        return h(React.Fragment, null,
          h("div", null, best.marginPct.toFixed(1), "%"),
          h("div", { style: { fontSize: 10.5, color: "#8A93A0", marginTop: 3 } }, best.vitola, " · ", best.label)
        );
      }
    },
    {
      label: "Best Box / Bundle Profit",
      render: (c) => {
        const allMargins = (c.sizes || []).flatMap((s) => (computePackageMargins(s) || []).map((m) => ({ ...m, vitola: s.vitola })));
        if (!allMargins.length) return "—";
        const best = allMargins.reduce((a, b) => b.grossProfit > a.grossProfit ? b : a);
        return h(React.Fragment, null,
          h("div", null, "$", best.grossProfit.toFixed(2)),
          h("div", { style: { fontSize: 10.5, color: "#8A93A0", marginTop: 3 } }, best.vitola, " · ", best.label)
        );
      }
    },
    { label: "Tasting Notes", render: (c) => (c.tastingNotes || []).join(", ") || "—" },
    { label: "Pairings", render: (c) => (c.pairings || []).join(", ") || "—" }
  ];

  return h("div", { style: { maxWidth: 1200, margin: "0 auto", padding: "24px" } },
    h("button", { className: "hg-btn", onClick: onClose, style: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#B8894C", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", padding: "6px 0", marginBottom: 18 } },
      h(ArrowLeft, { size: 16 }), " Back to list"
    ),
    h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 34, letterSpacing: 1, marginBottom: 4 } }, "Sales Comparison"),
    h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 12.5, color: "#8A93A0", letterSpacing: 0.8, marginBottom: 18 } }, "Compare product profile, pricing, and retailer economics side by side."),
    h("div", { className: "hg-scroll", style: { overflowX: "auto", border: "1px solid #3B2A1E", borderRadius: 8, background: "linear-gradient(180deg, #1d1712 0%, #171310 100%)" } },
      h("div", { style: { minWidth: compareIds.length === 3 ? 980 : 720, display: "grid", gridTemplateColumns: `170px repeat(${compareIds.length}, minmax(250px, 1fr))` } },
        h("div", { style: { padding: "18px 14px", borderBottom: "1px solid #3B2A1E", borderRight: "1px solid #3B2A1E" } }),
        compareIds.map((id) => {
          const c = cigars.find((x) => x.id === id);
          if (!c) return null;
          return h("div", { key: `header-${id}`, style: { padding: "18px 16px", borderBottom: "1px solid #3B2A1E", borderRight: "1px solid #3B2A1E" } },
            c.line && h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: 1.5, color: "#B8894C", textTransform: "uppercase" } }, c.line),
            h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 0.5, marginTop: 2 } }, c.name)
          );
        }),
        rows.map((row) => h(React.Fragment, { key: row.label },
          h("div", { style: { padding: "13px 14px", borderBottom: "1px solid #2c3036", borderRight: "1px solid #3B2A1E", fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase", color: "#8A93A0" } }, row.label),
          compareIds.map((id) => {
            const c = cigars.find((x) => x.id === id);
            if (!c) return null;
            return h("div", { key: `${row.label}-${id}`, style: { padding: "13px 16px", borderBottom: "1px solid #2c3036", borderRight: "1px solid #3B2A1E", fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, lineHeight: 1.45, color: row.label.includes("Margin") || row.label.includes("Profit") ? "#E7C79A" : "#EDE6D6" } }, row.render(c));
          })
        )),
        canUseOrderBuilder && h("div", { style: { padding: "14px", borderRight: "1px solid #3B2A1E", background: "rgba(184,137,76,0.04)" } },
          h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase", color: "#8A93A0" } }, "Order")
        ),
        canUseOrderBuilder && compareIds.map((id) => {
          const c = cigars.find((x) => x.id === id);
          if (!c) return null;
          return h("div", { key: `order-${id}`, style: { padding: "14px 16px", borderRight: "1px solid #3B2A1E", background: "rgba(184,137,76,0.04)" } },
            h("button", { type: "button", className: "hg-btn", onClick: () => onBuildOrder(c.id), style: { width: "100%", background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4, padding: "10px 14px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 12.5, letterSpacing: 0.8, textTransform: "uppercase" } },
              h(ShoppingCart, { size: 14, style: { marginRight: 6, verticalAlign: "middle" } }), "Build Order"
            )
          );
        })
      )
    ),
    h("div", { style: { marginTop: 14, fontFamily: "'Oswald', sans-serif", fontSize: 11.5, color: "#6E7681" } }, "On smaller screens, swipe horizontally to view all selected cigars.")
  );
}
