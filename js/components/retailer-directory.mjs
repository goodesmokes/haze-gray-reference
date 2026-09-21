import React, { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { RETAILER_FIELDS, formatRetailerPhone, retailerSearch } from "../domain/retailers.mjs";
import { assignedRepLabel, assignmentSummary, filterRetailerAssignments, isAssignableRetailerUser, retailerAssignments } from "../domain/assignments.mjs";
import { filterRetailerTerritories, normalizeTerritory, retailerTerritoryLabel, retailerTerritoryOptions, territoryMismatches } from "../domain/territories.mjs";
import { userButtonStyle, userFieldStyle } from "../ui/styles.mjs";
import { RetailerLocation } from "./common-ui.mjs";
import { RetailerAssignmentEditor, RetailerEditor } from "./retailer-editors.mjs";

const h = React.createElement;

export function RetailerDirectory({ directory, repDirectory, selectedId, onSelect, user, profile, permissions, draft, requirePermission, onStartOrder, onHistory, onClose, hasMeaningfulDraft, savedOrderDate }) {
  const [search, setSearch] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [territoryFilter, setTerritoryFilter] = useState("all");
  const [editingAssignments, setEditingAssignments] = useState(false);
  const [editor, setEditor] = useState(null);
  const [replace, setReplace] = useState(false);
  const selected = directory.records.find((item) => item.id === selectedId);
  useEffect(() => { setEditor(null); setReplace(false); setEditingAssignments(false); }, [selectedId, selected?.active]);
  const select = (id) => { if (requirePermission("canUseRetailers")) { setEditor(null); onSelect(id); } };
  const start = () => {
    if (!requirePermission("canUseRetailers") || !selected?.active) return;
    if (hasMeaningfulDraft(draft)) setReplace(true); else onStartOrder(selected.id);
  };
  const hasMine = directory.records.some((item) => retailerAssignments(item).includes(user.uid));
  const activeFilter = assignmentFilter || (permissions.canFilterOwnRetailers && !permissions.canAssignRetailers && hasMine ? "mine" : "all");
  const showMyRetailersEmptyState = activeFilter === "mine" && !hasMine;
  const territoryOptions = retailerTerritoryOptions(directory.records, permissions.canEditRetailerTerritory ? repDirectory.profiles : [], profile);
  const mismatches = territoryMismatches(selected, repDirectory.profiles, permissions.canEditRetailerTerritory);
  const results = filterRetailerTerritories(filterRetailerAssignments(directory.records, activeFilter, user.uid), territoryFilter, profile?.territory).filter((item) => retailerSearch(item, search));
  return h("div", { style: { maxWidth: 1000, margin: "0 auto", padding: 24 } },
    h("button", { className: "hg-btn", style: userButtonStyle, onClick: selectedId ? () => select(null) : onClose }, h(ArrowLeft, { size: 14 }), " ", selectedId ? "Back to Retailers" : "Back to list"),
    h("h1", { style: { fontFamily: "'Bebas Neue', sans-serif" } }, "Retailers"),
    directory.error && h("p", { role: "alert" }, directory.error, " ", h("button", { className: "hg-btn", style: userButtonStyle, onClick: directory.reload }, "Reload Retailers")),
    permissions.canAssignRetailers && repDirectory.error && h("p", { role: "alert" }, repDirectory.error, " Assignments are preserved. ", h("button", { className: "hg-btn", style: userButtonStyle, onClick: repDirectory.reload }, "Retry")),
    !directory.ready ? h("p", null, "Loading retailers…") : selectedId ? selected ? h(React.Fragment, null,
      h("h2", null, selected.name),
      h("p", null, selected.active ? "Active" : "Inactive — unavailable for new orders"),
      Object.entries(RETAILER_FIELDS).filter(([key]) => key !== "name").map(([key, label]) => selected[key] && h("p", { key, style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, h("strong", null, label, ":"), " ", key === "phone" ? formatRetailerPhone(selected.phone, selected.country) : selected[key])),
      h("section", { style: { overflowWrap: "anywhere" } },
        h("h3", null, "Territory"),
        h("p", null, retailerTerritoryLabel(selected)),
        permissions.canEditRetailerTerritory && h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => { if (requirePermission("canEditRetailerTerritory")) setEditor(selected); } }, "Edit Territory")
      ),
      h("section", { style: { overflowWrap: "anywhere" } },
        h("h3", null, "Assigned Users"),
        h("p", null, assignmentSummary(selected, user.uid, permissions.canAssignRetailers, repDirectory.profiles)),
        permissions.canAssignRetailers && h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => { if (requirePermission("canAssignRetailers")) setEditingAssignments(true); } }, "Edit Assigned Users")
      ),
      permissions.canEditRetailerTerritory && mismatches.length > 0 && h("div", { style: { color: "#8A93A0", fontSize: 13, overflowWrap: "anywhere" } }, mismatches.map((item) => h("p", { key: item.uid }, item.name, " — Home territory: ", item.territory, " · Retailer: ", retailerTerritoryLabel(selected), " · Cross-territory assignment (coverage is allowed)"))),
      h("p", null, "Created by ", selected.creatorDisplayName || "Not recorded", " · ", savedOrderDate(selected.createdAt)),
      h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
        h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => { if (requirePermission("canUseRetailers")) setEditor(selected); } }, "Edit Retailer"),
        h("button", { className: "hg-btn", style: userButtonStyle, disabled: !selected.active, onClick: start }, "Start New Order"),
        h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => { if (requirePermission("canUseRetailers")) onHistory(selected.id); } }, "View Linked Orders")
      ),
      h("p", { style: { color: "#8A93A0" } }, "Linked history uses exact retailer IDs. Older free-text orders remain available through Order History search.")
    ) : h("p", null, "This retailer is inactive, no longer exists, or is not available to your account.") : h(React.Fragment, null,
      h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => { if (requirePermission("canUseRetailers")) setEditor({}); } }, "+ Add Retailer"),
      h("div", { style: { marginTop: 16 } }, h("label", null, "Assignment filter ", h("select", { "aria-label": "Assignment filter", style: userFieldStyle, value: activeFilter, onChange: (event) => { setAssignmentFilter(event.target.value); if (!permissions.canEditRetailerTerritory) setTerritoryFilter("all"); } },
        h("option", { value: "all" }, permissions.canAssignRetailers ? "All Retailers" : "All Active Retailers"),
        permissions.canFilterOwnRetailers && h("option", { value: "mine" }, "My Retailers"),
        permissions.canAssignRetailers && h(React.Fragment, null,
          h("option", { value: "assigned" }, "Assigned"),
          h("option", { value: "unassigned" }, "Unassigned"),
          repDirectory.profiles.filter((profile) => isAssignableRetailerUser(profile) || directory.records.some((item) => retailerAssignments(item).includes(profile.uid))).map((profile) => h("option", { key: profile.uid, value: "rep:" + profile.uid }, assignedRepLabel(profile.uid, user.uid, true, repDirectory.profiles)))
        )
      ))),
      showMyRetailersEmptyState && h("p", null, "No retailers are currently assigned to you. ", h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => setAssignmentFilter("all") }, permissions.canAssignRetailers ? "All Retailers" : "All Active Retailers")),
      h("div", { style: { marginTop: 12 } },
        h("label", null, "Territory filter ", h("select", { "aria-label": "Territory filter", style: userFieldStyle, value: territoryFilter, onChange: (event) => { setTerritoryFilter(event.target.value); if (!permissions.canEditRetailerTerritory) setAssignmentFilter("all"); } },
          h("option", { value: "all" }, "All Territories"),
          h("option", { value: "mine", disabled: !normalizeTerritory(profile?.territory) }, "My Territory"),
          h("option", { value: "other" }, "Other Territories"),
          h("option", { value: "unassigned" }, "Unassigned Territory"),
          territoryOptions.map((option) => h("option", { key: option.value, value: "territory:" + option.value }, option.label))
        )),
        h("p", { style: { color: "#8A93A0", fontSize: 13 } }, permissions.canEditRetailerTerritory ? "Assignment and territory filters work together." : "My Retailers uses assignments; My Territory uses your current profile territory.", " ", h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => { setAssignmentFilter("all"); setTerritoryFilter("all"); setSearch(""); } }, permissions.canAssignRetailers ? "Show All Retailers" : "Show All Active Retailers"))
      ),
      !normalizeTerritory(profile?.territory) && h("p", null, "No territory is currently assigned to your user profile."),
      h("input", { "aria-label": "Search retailers", placeholder: "Search name, contact, city, state or territory…", style: { ...userFieldStyle, boxSizing: "border-box", margin: "16px 0" }, value: search, onChange: (e) => setSearch(e.target.value) }),
      !directory.records.length ? h("p", null, "No retailers yet.") : !results.length ? h("p", null, "No retailers match your search.") : results.map((item) => h("button", { key: item.id, className: "hg-btn", style: { ...userButtonStyle, display: "block", width: "100%", textAlign: "left", padding: 16, marginBottom: 10 }, onClick: () => select(item.id) },
        h("strong", null, item.name),
        permissions.canChangeRetailerStatus && h("span", null, " · ", item.active ? "Active" : "Inactive"),
        h(RetailerLocation, { retailer: item }),
        h("div", { style: { whiteSpace: "normal", overflowWrap: "anywhere" } }, "Territory: ", retailerTerritoryLabel(item)),
        h("div", null, [item.contactName, item.email, formatRetailerPhone(item.phone, item.country)].filter(Boolean).join(" · ")),
        h("div", { style: { whiteSpace: "normal", overflowWrap: "anywhere", marginTop: 6 } }, assignmentSummary(item, user.uid, permissions.canAssignRetailers, repDirectory.profiles, true))
      ))
    ),
    editor && (!editor.id || (selected && (selected.active || permissions.canChangeRetailerStatus))) && h(RetailerEditor, { retailer: editor.id ? editor : null, currentUid: user.uid, canChangeStatus: permissions.canChangeRetailerStatus, canAssign: permissions.canAssignRetailers, canEditTerritory: permissions.canEditRetailerTerritory, homeTerritory: profile?.territory, territoryOptions, repDirectory, requirePermission, onClose: () => setEditor(null), onSaved: select, onOpenExisting: select }),
    editingAssignments && selected && permissions.canAssignRetailers && h(RetailerAssignmentEditor, { retailer: selected, user, repDirectory, requirePermission, onClose: () => setEditingAssignments(false) }),
    replace && selected?.active && h("div", { role: "dialog", "aria-modal": "true", "aria-label": "Replace current order", style: { position: "fixed", inset: 0, zIndex: 65, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", padding: 16 } },
      h("div", { style: { background: "#1c1f24", border: "1px solid #B8894C", borderRadius: 8, padding: 24 } },
        h("h2", null, "Start New Order for ", selected.name, "?"),
        h("p", null, "Your current active draft will be replaced. Saved orders remain unchanged."),
        h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => { if (requirePermission("canUseRetailers")) onStartOrder(selected.id, true); } }, "Replace Current Order"),
        " ",
        h("button", { className: "hg-btn", style: userButtonStyle, onClick: () => setReplace(false) }, "Cancel")
      )
    )
  );
}
