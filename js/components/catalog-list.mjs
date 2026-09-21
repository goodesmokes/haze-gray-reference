import React from "react";
import { ChevronRight, Cigarette, Scale, Search } from "lucide-react";

const h = React.createElement;

export function CatalogList({ cigars, filtered, groupedFiltered, query, onQueryChange, strengthFilter, onStrengthFilterChange, sortBy, onSortChange, compareMode, onToggleCompareMode, compareIds, onSelectCigar, onToggleCompareId, onCompare, strengthWord, sizeSummary }) {
  return h("div", { style: { maxWidth: 900, margin: "0 auto", padding: "20px 24px" } },
    h("div", { style: { position: "relative", marginBottom: 12 } },
      h(Search, { size: 16, color: "#8A93A0", style: { position: "absolute", left: 12, top: 12 } }),
      h("input", { value: query, onChange: (event) => onQueryChange(event.target.value), placeholder: "Search by name, wrapper, vitola, tasting note…", style: { width: "100%", background: "#1c1f24", border: "1px solid #454b53", borderRadius: 5, padding: "10px 12px 10px 36px", color: "#EDE6D6", fontSize: 14 } })
    ),
    h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 } },
      h("select", { value: strengthFilter, onChange: (event) => onStrengthFilterChange(event.target.value), style: { background: "#1c1f24", border: "1px solid #454b53", borderRadius: 5, color: "#C9CFD6", fontFamily: "'Oswald', sans-serif", fontSize: 12.5, padding: "8px 10px" } },
        h("option", { value: "all" }, "All Strengths"),
        h("option", { value: "1" }, "Mild"),
        h("option", { value: "2" }, "Mild-Medium"),
        h("option", { value: "3" }, "Medium"),
        h("option", { value: "4" }, "Medium-Full"),
        h("option", { value: "5" }, "Full")
      ),
      h("select", { value: sortBy, onChange: (event) => onSortChange(event.target.value), style: { background: "#1c1f24", border: "1px solid #454b53", borderRadius: 5, color: "#C9CFD6", fontFamily: "'Oswald', sans-serif", fontSize: 12.5, padding: "8px 10px" } },
        h("option", { value: "name" }, "Sort: Name (A–Z)"),
        h("option", { value: "strength-asc" }, "Sort: Strength (Mild → Full)"),
        h("option", { value: "strength-desc" }, "Sort: Strength (Full → Mild)"),
        h("option", { value: "body-asc" }, "Sort: Body (Light → Full)"),
        h("option", { value: "body-desc" }, "Sort: Body (Full → Light)")
      ),
      h("button", { type: "button", className: "hg-btn", onClick: onToggleCompareMode, style: { display: "flex", alignItems: "center", gap: 6, background: compareMode ? "#B8894C" : "none", color: compareMode ? "#14161A" : "#C9CFD6", border: compareMode ? "1px solid #B8894C" : "1px solid #6E7681", borderRadius: 5, padding: "8px 14px", fontFamily: "'Oswald', sans-serif", fontSize: 12.5, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" } },
        h(Scale, { size: 14 }), " ", compareMode ? "Cancel Compare" : "Compare"
      )
    ),
    filtered.length === 0
      ? h("div", { style: { padding: "40px 0", textAlign: "center", color: "#8A93A0", fontFamily: "'Oswald', sans-serif" } }, cigars.length === 0 ? "No cigars logged yet. Add your first one." : "No matches for that search.")
      : h("div", { className: "hg-scroll", style: { display: "flex", flexDirection: "column", gap: 8 } },
          groupedFiltered.map((group) => h(React.Fragment, { key: group.name },
            h("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "14px 0 2px" } },
              h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 12.5, letterSpacing: 2, color: "#B8894C", textTransform: "uppercase", whiteSpace: "nowrap" } }, group.name),
              h("div", { style: { flex: 1, height: 1, background: "#2c3036" } }),
              h("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#5c636b" } }, group.items.length)
            ),
            group.items.map((c) => {
              const isChecked = compareIds.includes(c.id);
              return h("div", { key: c.id, className: "hg-row", onClick: () => compareMode ? onToggleCompareId(c.id) : onSelectCigar(c.id), style: { display: "flex", alignItems: "center", gap: 16, cursor: "pointer", border: isChecked ? "1px solid #B8894C" : "1px solid #2c3036", borderRadius: 6, padding: "12px 16px", background: isChecked ? "rgba(184,137,76,0.08)" : "rgba(255,255,255,0.015)", transition: "background 0.15s, border-color 0.15s" } },
                compareMode
                  ? h("div", { style: { width: 20, height: 20, flex: "0 0 20px", borderRadius: 4, border: isChecked ? "none" : "1px solid #6E7681", background: isChecked ? "#B8894C" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" } }, isChecked && h("span", { style: { color: "#14161A", fontSize: 13, fontWeight: 700 } }, "✓"))
                  : h(Cigarette, { size: 16, color: "#454b53", style: { flex: "0 0 16px" } }),
                h("div", { style: { width: 44, height: 44, borderRadius: 4, background: "#0e0d0b", flex: "0 0 44px", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid #3B2A1E" } },
                  c.imageUrl ? h("img", { src: c.imageUrl, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } }) : h(Cigarette, { size: 20, color: "#454b53" })
                ),
                h("div", { style: { flex: 1, minWidth: 0 } },
                  h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: 0.5, lineHeight: 1.1 } }, c.name),
                  h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 12, color: "#8A93A0", letterSpacing: 0.5 } }, sizeSummary(c), " · ", c.wrapper)
                ),
                h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#E7C79A", border: "1px solid #B8894C", borderRadius: 3, padding: "3px 8px", whiteSpace: "nowrap" } }, strengthWord(c.strength)),
                !compareMode && h(ChevronRight, { size: 18, color: "#454b53" })
              );
            })
          ))
        ),
    compareMode && compareIds.length >= 2 && h("div", { style: { position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 40 } },
      h("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 13, color: "#EDE6D6" } }, compareIds.length, " cigars selected"),
      h("button", { className: "hg-btn", onClick: onCompare, style: { background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4, padding: "8px 16px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 12.5 } }, "Compare →")
    )
  );
}
