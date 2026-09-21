import React from "react";
import { retailerLocation } from "../domain/retailers.mjs";

export function getGaugePosition(value, cx = 60, cy = 62, r = 44) {
  const v = Math.min(5, Math.max(1, Number(value) || 1));
  const angle = Math.PI + ((v - 1) / 4) * Math.PI;
  return {
    value: v,
    x: cx + r * 0.78 * Math.cos(angle),
    y: cy + r * 0.78 * Math.sin(angle),
  };
}

export function Gauge({ value, label }) {
  const cx = 60, cy = 62, r = 44;
  const { value: v, x: nx2, y: ny2 } = getGaugePosition(value, cx, cy, r);
  const ticks = [1, 2, 3, 4, 5].map((t) => {
    const ta = (-90 + ((t - 1) / 4) * 180 - 90) * Math.PI / 180;
    return {
      x1: cx + (r + 2) * Math.cos(ta), y1: cy + (r + 2) * Math.sin(ta),
      x2: cx + (r - 6) * Math.cos(ta), y2: cy + (r - 6) * Math.sin(ta), t,
    };
  });
  return React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 2 } },
    React.createElement("svg", { viewBox: "0 0 120 72", width: "120", height: "72" },
      React.createElement("path", { d: `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`, fill: "none", stroke: "#454b53", strokeWidth: "8", strokeLinecap: "round" }),
      ticks.map((tk, i) => React.createElement("line", { key: i, x1: tk.x1, y1: tk.y1, x2: tk.x2, y2: tk.y2, stroke: "#B8894C", strokeWidth: "2" })),
      React.createElement("line", { x1: cx, y1: cy, x2: nx2, y2: ny2, stroke: "#A8402E", strokeWidth: "3", strokeLinecap: "round" }),
      React.createElement("circle", { cx, cy, r: "5", fill: "#B8894C", stroke: "#14161A", strokeWidth: "1.5" })
    ),
    React.createElement("div", { style: { fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#EDE6D6", letterSpacing: 1, marginTop: -14 } }, `${v}/5`),
    React.createElement("div", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 3, color: "#8A93A0", textTransform: "uppercase" } }, label)
  );
}

export function Tag({ children, tone = "steel" }) {
  const tones = {
    steel: { bg: "rgba(110,118,129,0.18)", border: "#6E7681", color: "#C9CFD6" },
    brass: { bg: "rgba(184,137,76,0.16)", border: "#B8894C", color: "#E7C79A" },
  };
  const s = tones[tone];
  return React.createElement("span", { style: {
    display: "inline-block", padding: "5px 12px", margin: "0 6px 6px 0",
    fontFamily: "'Oswald', sans-serif", fontSize: 12.5, letterSpacing: 0.5,
    background: s.bg, border: `1px solid ${s.border}`, color: s.color, borderRadius: 3,
  } }, children);
}

export function RetailerLocation({ retailer }) {
  const location = retailerLocation(retailer);
  return location ? React.createElement("div", { style: { display: "block", marginTop: 6, color: "#C9CFD6", whiteSpace: "normal", overflowWrap: "anywhere" } }, location) : null;
}
