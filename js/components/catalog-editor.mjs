import React from "react";
import { Cigarette, Plus, X } from "lucide-react";
import { isValidCatalogImageUrl, CATALOG_IMAGE_ERROR } from "../domain/catalog-images.mjs";

const h = React.createElement;
const labelStyle = { fontFamily: "'Oswald', sans-serif", fontSize: 11, letterSpacing: 1.5, color: "#8A93A0", textTransform: "uppercase" };
const inputStyle = { width: "100%", marginTop: 4, background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "8px 10px", color: "#EDE6D6", fontSize: 14 };
const sizeInputStyle = { background: "#14161A", border: "1px solid #454b53", borderRadius: 4, padding: "7px 9px", color: "#EDE6D6", fontSize: 13.5 };

function TextField({ field, label, form, onChange }) {
  return h("div", { style: { marginBottom: 12 } },
    h("label", { style: labelStyle }, label),
    h("input", { value: form[field], onChange: (event) => onChange({ ...form, [field]: event.target.value }), style: inputStyle })
  );
}

export function CatalogEditor({ form, editingId, onClose, onFormChange, onSetSizeField, onAddSize, onRemoveSize, onSave }) {
  const validImage = isValidCatalogImageUrl(form.imageUrl);
  return h("div", {
    style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 },
    onClick: onClose
  },
  h("div", {
    onClick: (event) => event.stopPropagation(),
    className: "hg-scroll",
    style: { background: "#1c1f24", border: "1px solid #454b53", borderRadius: 8, width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", padding: 24 }
  },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } },
      h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: 1 } }, editingId ? "Edit Cigar" : "Add Cigar"),
      h("button", { className: "hg-btn", onClick: onClose, style: { background: "none", border: "none", color: "#8A93A0" } }, h(X, { size: 20 }))
    ),
    h(TextField, { field: "name", label: "Name", form, onChange: onFormChange }),
    h(TextField, { field: "line", label: "Line / Series", form, onChange: onFormChange }),
    h("div", { style: { marginBottom: 12 } },
      h("label", { htmlFor: "catalog-image-path", style: labelStyle }, "Catalog Image Path"),
      h("input", {
        id: "catalog-image-path", value: form.imageUrl ?? "",
        placeholder: "/haze-gray-reference/assets/cigars/example.webp",
        "aria-invalid": !validImage, "aria-describedby": "catalog-image-help",
        onChange: (event) => onFormChange({ ...form, imageUrl: event.target.value }), style: inputStyle
      }),
      h("div", { id: "catalog-image-help", role: validImage ? undefined : "alert", style: { color: validImage ? "#8A93A0" : "#d98a7c", fontSize: 12, marginTop: 6 } },
        validImage ? "Enter the path of a WebP image already in the repository. Match the filename capitalization exactly. Leave empty for no image." : CATALOG_IMAGE_ERROR
      ),
      h("div", { style: { width: 64, height: 64, marginTop: 8, overflow: "hidden" } },
        validImage && form.imageUrl
          ? h("img", { src: form.imageUrl, alt: "Catalog image preview", style: { width: "100%", height: "100%", objectFit: "cover" } })
          : h(Cigarette, { size: 22, color: "#454b53" })
      )
    ),
    [["wrapper", "Wrapper"], ["binder", "Binder"], ["filler", "Filler"], ["origin", "Origin"]].map(([field, label]) => h(TextField, { key: field, field, label, form, onChange: onFormChange })),
    h("div", { style: { display: "flex", gap: 12, marginBottom: 12 } },
      ["strength", "body"].map((field) => h("div", { key: field, style: { flex: 1 } },
        h("label", { style: labelStyle }, field === "strength" ? "Strength (1–5)" : "Body (1–5)"),
        h("input", { type: "number", min: 1, max: 5, value: form[field], onChange: (event) => onFormChange({ ...form, [field]: event.target.value }), style: inputStyle })
      ))
    ),
    h("div", { style: { marginBottom: 16 } },
      h("label", { style: labelStyle }, "Sizes & Pricing"),
      h("div", { style: { marginTop: 8, display: "flex", flexDirection: "column", gap: 12 } },
        form.sizes.map((size, index) => h("div", { key: size.key, style: { border: "1px solid #3B2A1E", borderRadius: 5, padding: 10, position: "relative" } },
          form.sizes.length > 1 && h("button", { type: "button", className: "hg-btn", onClick: () => onRemoveSize(index), style: { position: "absolute", top: 8, right: 8, background: "none", border: "none", color: "#8A93A0" } }, h(X, { size: 14 })),
          h("div", { style: { display: "flex", gap: 8, marginBottom: 8 } },
            h("input", { placeholder: "Vitola (e.g. Toro)", value: size.vitola, onChange: (event) => onSetSizeField(index, "vitola", event.target.value), style: { ...sizeInputStyle, flex: 1 } }),
            h("input", { placeholder: "Size (e.g. 52 x 6)", value: size.dims, onChange: (event) => onSetSizeField(index, "dims", event.target.value), style: { ...sizeInputStyle, flex: 1 } })
          ),
          h("label", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: 1, color: "#8A93A0", textTransform: "uppercase" } }, "MSRP"),
          h("input", { placeholder: "Suggested retail price", value: size.msrp, onChange: (event) => onSetSizeField(index, "msrp", event.target.value), style: { ...sizeInputStyle, width: "100%", marginTop: 3, marginBottom: 8 } }),
          h("label", { style: { fontFamily: "'Oswald', sans-serif", fontSize: 10, letterSpacing: 1, color: "#8A93A0", textTransform: "uppercase" } }, "Keystone Pricing"),
          h("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 3 } },
            [["keystoneSingle", "Single unit cost (e.g. $6.45 box / $6.20 bundle)"], ["keystoneBox10", "10ct Box price"], ["keystoneBox20", "20ct Box price"], ["keystoneBundle20", "20ct Bundle price"]].map(([field, placeholder]) => h("input", { key: field, placeholder, value: size[field], onChange: (event) => onSetSizeField(index, field, event.target.value), style: sizeInputStyle }))
          )
        ))
      ),
      h("button", { type: "button", className: "hg-btn", onClick: onAddSize, style: { display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px dashed #6E7681", color: "#C9CFD6", borderRadius: 4, padding: "8px 12px", fontFamily: "'Oswald', sans-serif", fontSize: 12.5, marginTop: 8, width: "100%", justifyContent: "center" } }, h(Plus, { size: 14 }), " Add another size")
    ),
    [["tastingNotes", "Tasting Notes (comma-separated)"], ["pairings", "Pairing Suggestions (comma-separated)"]].map(([field, label]) => h("div", { key: field, style: { marginBottom: 12 } },
      h("label", { style: labelStyle }, label),
      h("input", { value: form[field], onChange: (event) => onFormChange({ ...form, [field]: event.target.value }), placeholder: "e.g. cedar, black pepper, cocoa", style: inputStyle })
    )),
    h("div", { style: { marginBottom: 18 } },
      h("label", { style: labelStyle }, "Construction / Burn Notes (optional)"),
      h("textarea", { value: form.notes, onChange: (event) => onFormChange({ ...form, notes: event.target.value }), rows: 3, style: { ...inputStyle, resize: "vertical" } })
    ),
    h("div", { style: { display: "flex", gap: 10, justifyContent: "flex-end" } },
      h("button", { className: "hg-btn", onClick: onClose, style: { background: "none", border: "1px solid #454b53", color: "#C9CFD6", borderRadius: 4, padding: "9px 16px", fontFamily: "'Oswald', sans-serif", fontSize: 13 } }, "Cancel"),
      h("button", { className: "hg-btn", onClick: onSave, disabled: !validImage, style: { background: "#B8894C", border: "none", color: "#14161A", borderRadius: 4, padding: "9px 16px", fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 13 } }, editingId ? "Save Changes" : "Add Cigar")
    )
  ));
}
