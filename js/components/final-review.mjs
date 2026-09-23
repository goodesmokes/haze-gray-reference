import React from "react";
import { ArrowLeft, Copy, Mail } from "lucide-react";
import { SaveOrderPanel } from "./save-order-panel.mjs";

const h = React.createElement;

export function FinalReview({ draft, user, userProfile, cigars, packOptions, requirePermission, orderWholesaleTotal, copyConfirmed, onBack, onContinue, onStartNew, onEmail, onCopy }) {
  const { orderItems, orderRetailer, orderEmail, orderNotes } = draft;
  return h("div", { style: { maxWidth: 900, margin: "0 auto", padding: "24px" } },
    h("button", { className: "hg-btn", onClick: onBack, style: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#B8894C", fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: 1, textTransform: "uppercase", padding: "6px 0", marginBottom: 18 } },
      h(ArrowLeft, { size: 16 }), " Back to Order Builder"
    ),
    h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, letterSpacing: 1, marginBottom: 6 } }, "Final Review"),
    h("div", { style: { fontFamily: "'Oswald', sans-serif", color: "#8A93A0", fontSize: 13, letterSpacing: 1, marginBottom: 24 } }, "REVIEW ORDER BEFORE SUBMISSION"),
    h("div", { style: { border: "1px solid #2C3036", borderRadius: 8, padding: "16px 18px", marginBottom: 20 } },
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 } },
        h("div", null,
          h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 4 } }, "Retailer"),
          h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 17, color: "#EDE6D6" } }, orderRetailer || "—")
        ),
        h("div", null,
          h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 4 } }, "Contact Email"),
          h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 17, color: "#EDE6D6" } }, orderEmail || "—")
        )
      )
    ),
    h("div", { style: { border: "1px solid #2C3036", borderRadius: 8, overflow: "hidden", marginBottom: 20 } },
      h("div", { style: { display: "grid", gridTemplateColumns: "2fr 1.2fr 1.2fr .6fr 1fr", gap: 12, padding: "12px 16px", background: "#1B1E22", borderBottom: "1px solid #2C3036", fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" } },
        h("div", null, "Cigar"), h("div", null, "Size"), h("div", null, "Package"), h("div", null, "Qty"), h("div", { style: { textAlign: "right" } }, "Total")
      ),
      orderItems.map((line) => {
        const lineTotal = line.unitPrice * line.qty;
        return h("div", { key: line.lineKey, style: { display: "grid", gridTemplateColumns: "2fr 1.2fr 1.2fr .6fr 1fr", gap: 12, padding: "14px 16px", borderBottom: "1px solid #2C3036", alignItems: "center" } },
          h("div", { style: { fontFamily: "'Oswald', sans-serif", fontWeight: 600, color: "#EDE6D6" } }, line.cigarName),
          h("div", { style: { fontFamily: "'Oswald', sans-serif", color: "#C9CFD6" } }, line.vitola, " ", line.dims ? `(${line.dims})` : ""),
          h("div", { style: { fontFamily: "'Oswald', sans-serif", color: "#C9CFD6" } }, line.packLabel),
          h("div", { style: { fontFamily: "'JetBrains Mono', monospace", color: "#EDE6D6" } }, line.qty),
          h("div", { style: { fontFamily: "'JetBrains Mono', monospace", color: "#EDE6D6", textAlign: "right" } }, "$", lineTotal.toFixed(2))
        );
      }),
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", background: "rgba(184,137,76,0.08)" } },
        h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 1.5, color: "#B8894C", textTransform: "uppercase" } }, "Order Total"),
        h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: "#EDE6D6" } }, "$", orderWholesaleTotal.toFixed(2))
      )
    ),
    orderNotes && h("div", { style: { border: "1px solid #2C3036", borderRadius: 8, padding: "16px 18px", marginBottom: 20 } },
      h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase", marginBottom: 6 } }, "Notes"),
      h("div", { style: { fontFamily: "'Lora', serif", color: "#C9CFD6", lineHeight: 1.6 } }, orderNotes)
    ),
    h(SaveOrderPanel, { key: `${user.uid}:${userProfile.role}`, draft, user, profile: userProfile, cigars, packOptions, requirePermission, onContinue, onStartNew }),
    h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
      h("button", { className: "hg-btn", onClick: onEmail, style: { display: "flex", alignItems: "center", gap: 8, background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 13 } },
        h(Mail, { size: 15 }), " Email Order"
      ),
      h("button", { className: "hg-btn", onClick: onCopy, style: { display: "flex", alignItems: "center", gap: 8, background: "none", border: "1px solid #6E7681", color: "#C9CFD6", borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13 } },
        h(Copy, { size: 15 }), " ", copyConfirmed ? "Copied!" : "Copy Order"
      ),
      h("button", { className: "hg-btn", onClick: onBack, style: { display: "flex", alignItems: "center", gap: 8, background: "none", border: "1px solid #6E7681", color: "#C9CFD6", borderRadius: 4, padding: "10px 18px", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13 } },
        h(ArrowLeft, { size: 15 }), " Back to Builder"
      )
    )
  );
}
