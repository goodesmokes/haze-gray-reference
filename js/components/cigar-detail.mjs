import React from "react";
import { ArrowLeft, Cigarette, Pencil, Trash2 } from "lucide-react";
import { computePackageMargins } from "../domain/pricing.mjs";
import { Gauge, Tag } from "./common-ui.mjs";

const h = React.createElement;

function marginDisplay(size) {
  const margins = computePackageMargins(size);
  if (!margins) return null;
  return h("div", { style: { marginTop: 10, paddingTop: 10, borderTop: "1px dashed #3B2A1E" } },
    h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 7 } }, "Retailer Profit"),
    h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
      margins.map((margin) => h("div", { key: margin.key, style: { borderLeft: "2px solid #B8894C", paddingLeft: 8 } },
        h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1, color: "#C9CFD6", textTransform: "uppercase" } }, margin.label),
        h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#E7C79A", marginTop: 2 } }, "$", margin.grossProfit.toFixed(2), " profit · ", margin.marginPct.toFixed(1), "% margin"),
        h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#8A93A0", marginTop: 2 } }, "Cost $", margin.cost.toFixed(2), " · Retail $", margin.retailValue.toFixed(2))
      ))
    )
  );
}

export function CigarDetail({ selected, canEditCatalog, user, orderControls, onBack, onEdit, onDelete }) {
  return h("div", { style: { maxWidth: 900, margin: "0 auto", padding: "24px" } },
    h("button", { className: "hg-btn", onClick: onBack, style: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#B8894C", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", padding: "6px 0", marginBottom: 18 } },
      h(ArrowLeft, { size: 16 }), " Back to list"
    ),
    h("div", { style: { border: "1px solid #3B2A1E", borderRadius: 8, overflow: "hidden", background: "linear-gradient(180deg, #1d1712 0%, #171310 100%)" } },
      h("div", { style: { display: "flex", flexWrap: "wrap", gap: 0 } },
        h("div", { style: { width: 220, minHeight: 220, flex: "0 0 220px", background: "#0e0d0b", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #3B2A1E" } },
          selected.imageUrl ? h("img", { src: selected.imageUrl, alt: selected.name, style: { width: "100%", height: "100%", objectFit: "cover" } }) : h(Cigarette, { size: 56, color: "#454b53" })
        ),
        h("div", { style: { flex: "1 1 300px", padding: "22px 24px" } },
          selected.line && h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 12, letterSpacing: 2, color: "#B8894C", textTransform: "uppercase" } }, selected.line),
          h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 44, letterSpacing: 1, lineHeight: 1.05, margin: "2px 0 10px" } }, selected.name),
          h("div", { style: { display: "flex", gap: 24, flexWrap: "wrap" } },
            h(Gauge, { value: selected.strength, label: "Strength" }),
            h(Gauge, { value: selected.body, label: "Body" })
          )
        )
      ),
      h("div", { style: { borderTop: "1px solid #3B2A1E", padding: "20px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 } },
        [["Wrapper", selected.wrapper], ["Binder", selected.binder], ["Filler", selected.filler], ["Origin", selected.origin]].map(([label, value]) => h("div", { key: label },
          h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase" } }, label),
          h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 14.5, color: "#EDE6D6", marginTop: 2 } }, value || "—")
        ))
      ),
      h("div", { style: { borderTop: "1px solid #3B2A1E", padding: "20px 24px" } },
        h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase", marginBottom: 12 } }, "Sizes & Pricing"),
        orderControls,
        (selected.sizes || []).length === 0
          ? h("div", { style: { color: "#8A93A0", fontSize: 13.5, fontStyle: "italic" } }, "No sizes on file.")
          : h("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, selected.sizes.map((size) => h("div", { key: size.key, style: { border: "1px solid #2c3036", borderRadius: 6, overflow: "hidden" } },
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "rgba(184,137,76,0.07)", borderBottom: "1px solid #2c3036" } },
                h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 14, letterSpacing: 0.5, color: "#E7C79A" } }, size.vitola || "—", size.dims ? ` · ${size.dims}` : "")
              ),
              h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 } },
                h("div", { style: { padding: "12px 14px", borderRight: "1px solid #2c3036" } },
                  h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 6 } }, "MSRP"),
                  h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#B8894C" } }, size.msrp || "—")
                ),
                h("div", { style: { padding: "12px 14px" } },
                  h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 10.5, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 6 } }, "Keystone Pricing"),
                  h("div", { style: { display: "flex", flexDirection: "column", gap: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 } },
                    h("div", null, h("span", { style: { color: "#8A93A0" } }, "Single: "), size.keystoneSingle || "—"),
                    h("div", null, h("span", { style: { color: "#8A93A0" } }, "10ct Box: "), size.keystoneBox10 || "—"),
                    h("div", null, h("span", { style: { color: "#8A93A0" } }, "20ct Box: "), size.keystoneBox20 || "—"),
                    h("div", null, h("span", { style: { color: "#8A93A0" } }, "20ct Bundle: "), size.keystoneBundle20 || "—")
                  ),
                  marginDisplay(size)
                )
              )
            )))
      ),
      h("div", { style: { borderTop: "1px solid #3B2A1E", padding: "20px 24px" } },
        h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase", marginBottom: 8 } }, "Tasting Notes"),
        (selected.tastingNotes || []).length ? (selected.tastingNotes || []).map((note, index) => h(Tag, { key: index, tone: "brass" }, note)) : h("div", { style: { color: "#8A93A0", fontSize: 13.5, fontStyle: "italic" } }, "None on file.")
      ),
      h("div", { style: { borderTop: "1px solid #3B2A1E", padding: "20px 24px" } },
        h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase", marginBottom: 8 } }, "Pairing Suggestions"),
        (selected.pairings || []).length ? (selected.pairings || []).map((pairing, index) => h(Tag, { key: index, tone: "steel" }, pairing)) : h("div", { style: { color: "#8A93A0", fontSize: 13.5, fontStyle: "italic" } }, "None on file.")
      ),
      selected.notes && h("div", { style: { borderTop: "1px solid #3B2A1E", padding: "20px 24px" } },
        h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 2, color: "#8A93A0", textTransform: "uppercase", marginBottom: 8 } }, "Notes"),
        h("div", { style: { fontStyle: "italic", color: "#C9CFD6", fontSize: 14.5, lineHeight: 1.5 } }, selected.notes)
      ),
      h("div", { style: { borderTop: "1px solid #3B2A1E", padding: "18px 24px", display: "flex", justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 12, background: "rgba(184,137,76,0.06)" } },
        canEditCatalog
          ? h("div", { style: { display: "flex", gap: 10 } },
              h("button", { className: "hg-btn", onClick: () => onEdit(selected), style: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #6E7681", color: "#C9CFD6", borderRadius: 4, padding: "8px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 12.5 } }, h(Pencil, { size: 14 }), " Edit"),
              h("button", { className: "hg-btn", onClick: () => onDelete(selected.id), style: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid #A8402E", color: "#d98a7c", borderRadius: 4, padding: "8px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 12.5 } }, h(Trash2, { size: 14 }), " Delete")
            )
          : h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 12, color: "#5c636b", fontStyle: "italic" } }, user ? "Catalog editing is not available for this account" : "Sign in to edit this card")
      )
    )
  );
}
