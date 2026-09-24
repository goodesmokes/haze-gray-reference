import React, { useEffect, useState } from "react";
import { Plus, ShoppingCart } from "lucide-react";
import { getNumericPrice, getSinglePrice } from "../domain/pricing.mjs";

const h = React.createElement;

export function DetailOrderControls({ cigar, packOptions, orderItems, onAdd, onViewOrder }) {
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
  return h("div", { style: { marginBottom: 14 } },
    h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
      h("button", { type: "button", className: "hg-btn", onClick: open, disabled: !sizes.length, "aria-expanded": expanded, style: { ...buttonStyle, background: "#B8894C", color: "#14161A", opacity: sizes.length ? 1 : 0.5 } }, h(Plus, { size: 14 }), " Add to Order"),
      h("button", { type: "button", className: "hg-btn", onClick: onViewOrder, style: buttonStyle }, h(ShoppingCart, { size: 14 }), ` View Order (${totalQuantity})`)
    ),
    !sizes.length && h("div", { style: { color: "#8A93A0", fontSize: 12, marginTop: 8 } }, "No sizes with available order pricing."),
    h("div", { role: "status", "aria-live": "polite", style: { color: "#B8894C", fontFamily: "'Oswald', sans-serif", fontSize: 13, marginTop: notice ? 8 : 0 } }, notice),
    expanded && h("form", { onSubmit: confirm, noValidate: true, style: { border: "1px solid #3B2A1E", borderRadius: 6, padding: 14, marginTop: 12 } },
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, fontFamily: "'Oswald', sans-serif", color: "#8A93A0", fontSize: 12 } },
        h("label", null, "Vitola / Size",
          h("select", { value: sizeKey, onChange: (event) => { const next = sizes.find((item) => item.key === event.target.value); setSizeKey(event.target.value); setPackKey(next ? packagesFor(next)[0].key : ""); setValidation(""); }, style: fieldStyle },
            !size && h("option", { value: "" }, "Select a size"),
            sizes.map((item) => h("option", { key: item.key, value: item.key }, item.vitola || "Size", item.dims ? ` (${item.dims})` : ""))
          )
        ),
        h("label", null, "Package / Count",
          h("select", { value: packKey, onChange: (event) => { setPackKey(event.target.value); setValidation(""); }, style: fieldStyle },
            !pack && h("option", { value: "" }, "Select a package"),
            packages.map((item) => h("option", { key: item.key, value: item.key }, `${item.label} — $${item.price.toFixed(2)}`))
          )
        ),
        h("label", null, "Quantity",
          h("input", { type: "number", min: "1", step: "1", value: quantity, onChange: (event) => { setQuantity(event.target.value); setValidation(""); }, style: fieldStyle })
        )
      ),
      validation && h("div", { role: "alert", style: { color: "#d98a7c", fontSize: 13, marginTop: 10 } }, validation),
      h("div", { style: { display: "flex", gap: 10, marginTop: 12 } },
        h("button", { type: "submit", className: "hg-btn", style: { ...buttonStyle, background: "#B8894C", color: "#14161A" } }, "Confirm Add"),
        h("button", { type: "button", className: "hg-btn", onClick: () => setExpanded(false), style: buttonStyle }, "Cancel")
      )
    )
  );
}
