import React, { useEffect, useRef, useState } from "react";
import { RETAILER_AUTOCOMPLETE, RETAILER_FIELDS, formatRetailerPhone } from "../domain/retailers.mjs";
import { assignedRepLabel, isAssignableRetailerUser, retailerAssignments } from "../domain/assignments.mjs";
import { retailerTerritoryLabel, territoryDisplay } from "../domain/territories.mjs";
import { auth } from "../services/firebase.mjs";
import { saveRetailerAssignments, saveRetailerProfile } from "../services/retailer-service.mjs";
import { userButtonStyle, userFieldStyle } from "../ui/styles.mjs";

const h = React.createElement;

export function RetailerPhoneInput({ value, country, disabled, onChange }) {
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

export function RepAssignmentChoices({ value, onChange, repDirectory, disabled }) {
  const choices = repDirectory.profiles.filter((profile) => isAssignableRetailerUser(profile) || value.includes(profile.uid));
  const missing = value.filter((uid) => !choices.some((profile) => profile.uid === uid));
  return h("fieldset", { disabled, style: { border: "1px solid #555", padding: 12, margin: "16px 0", overflowWrap: "anywhere" } },
    h("legend", null, `Assigned Users (${value.length}/10)`),
    !value.length && h("p", null, "Unassigned"),
    !repDirectory.ready && h("p", null, "Loading assignment profiles…"),
    repDirectory.error && h("p", { role: "alert" }, repDirectory.error, " ", h("button", { type: "button", className: "hg-btn", style: userButtonStyle, onClick: repDirectory.reload }, "Retry")),
    repDirectory.ready && !repDirectory.error && !repDirectory.profiles.some(isAssignableRetailerUser) && h("p", null, "No active Owners, Admins, or Field Reps are available."),
    [...choices.map((profile) => profile.uid), ...missing].map((uid) => h("label", { key: uid, style: { display: "block", margin: "8px 0" } },
      h("input", { type: "checkbox", checked: value.includes(uid), disabled: !value.includes(uid) && (!repDirectory.ready || Boolean(repDirectory.error) || value.length >= 10), onChange: (event) => onChange(event.target.checked ? [...value, uid] : value.filter((id) => id !== uid)) }),
      " ", assignedRepLabel(uid, "", true, repDirectory.profiles)
    )),
    h("p", { style: { color: "#8A93A0", marginBottom: 0 } }, "Assignments indicate responsibility. All active retailers remain shared.")
  );
}

export function RetailerAssignmentEditor({ retailer, user, repDirectory, requirePermission, onClose }) {
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
  return h("div", { role: "dialog", "aria-modal": "true", "aria-label": "Edit Assigned Users", style: { position: "fixed", inset: 0, zIndex: 66, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", padding: 16 } },
    h("form", { onSubmit: submit, className: "hg-scroll", style: { background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: 20, width: "100%", boxSizing: "border-box", maxWidth: 640, maxHeight: "85vh", overflowY: "auto" } },
      h("h2", null, "Assigned Users — ", retailer.name),
      h(RepAssignmentChoices, { value, onChange: setValue, repDirectory, disabled: saving }),
      error && h("p", { role: "alert", style: { color: "#d98a7c" } }, error),
      h("button", { className: "hg-btn", style: userButtonStyle, disabled: saving }, saving ? "Saving…" : "Save Assignments"),
      " ",
      h("button", { type: "button", className: "hg-btn", style: userButtonStyle, onClick: onClose }, "Cancel")
    )
  );
}

export function RetailerEditor({ retailer, currentUid, canChangeStatus, canAssign, canEditTerritory, homeTerritory, territoryOptions, repDirectory, requirePermission, onClose, onSaved, onOpenExisting }) {
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
  return h("div", { role: "dialog", "aria-modal": "true", "aria-label": retailer ? "Edit Retailer" : "Add Retailer", style: { position: "fixed", inset: 0, zIndex: 65, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } },
    h("form", { onSubmit: submit, className: "hg-scroll", style: { background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: 20, width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto" } },
      h("h2", null, retailer ? "Edit Retailer" : "Add Retailer"),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 } },
        Object.entries(RETAILER_FIELDS).map(([key, label]) => h("label", { key }, label, key === "name" ? " *" : "",
          key === "phone" ? h(RetailerPhoneInput, { value: form.phone, country: form.country, disabled: saving, onChange: (phone) => setForm((previous) => ({ ...previous, phone })) }) :
            key === "notes" ? h("textarea", { "aria-label": label, value: form[key], maxLength: 5000, disabled: saving, onChange: (e) => setForm({ ...form, [key]: e.target.value }), style: { ...userFieldStyle, boxSizing: "border-box" } }) :
              h("input", { "aria-label": label, autoComplete: RETAILER_AUTOCOMPLETE[key], value: form[key], required: key === "name", maxLength: 500, disabled: saving, onChange: (e) => setForm({ ...form, [key]: e.target.value }), style: { ...userFieldStyle, boxSizing: "border-box" } })
        ))
      ),
      canEditTerritory ? h("label", { style: { display: "block", marginTop: 12 } }, "Territory",
        h("input", { "aria-label": "Retailer territory", autoComplete: "off", list: "retailer-territory-options", value: territory, maxLength: 500, disabled: saving, onChange: (event) => setTerritory(event.target.value), style: { ...userFieldStyle, boxSizing: "border-box" }, placeholder: "Unassigned Territory" }),
        h("datalist", { id: "retailer-territory-options" }, territoryOptions.map((option) => h("option", { key: option.value, value: option.label })))
      ) : h("p", null, "Territory: ", retailer ? retailerTerritoryLabel(retailer) : territoryDisplay(homeTerritory) || "Unassigned Territory", !retailer && " (from your current user profile)"),
      !retailer && canAssign && h(RepAssignmentChoices, { value: assignments, onChange: setAssignments, repDirectory, disabled: saving }),
      retailer && canChangeStatus && h("label", null, h("input", { type: "checkbox", checked: form.active, disabled: saving, onChange: (e) => setForm({ ...form, active: e.target.checked }) }), " Active"),
      error && h("p", { role: "alert", style: { color: "#d98a7c" } }, error),
      duplicateId && h("button", { type: "button", className: "hg-btn", style: userButtonStyle, onClick: () => onOpenExisting(duplicateId) }, "Open Existing Retailer"),
      h("div", { style: { display: "flex", gap: 10, marginTop: 16 } },
        h("button", { className: "hg-btn", style: userButtonStyle, disabled: saving }, saving ? "Saving…" : "Save Retailer"),
        h("button", { type: "button", className: "hg-btn", style: userButtonStyle, onClick: onClose }, "Cancel")
      )
    )
  );
}
