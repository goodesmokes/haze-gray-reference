import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ROLE_LABELS, authorizationUpdateError, canManageAuthorizationProfile, getAssignableRoles, isValidRole } from "../domain/authorization.mjs";
import { subscribeAuthorizedUsers } from "../services/profile-service.mjs";
import { userButtonStyle, userFieldStyle } from "../ui/styles.mjs";

const h = React.createElement;

export function AuthorizationProfileEditor({ profile, currentUid, managerProfile, onSave, onClose }) {
  const [role, setRole] = useState(profile.role || "");
  const [territory, setTerritory] = useState(profile.territory || "");
  const [active, setActive] = useState(profile.active === true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setRole(profile.role || "");
    setTerritory(profile.territory || "");
    setActive(profile.active === true);
  }, [profile.role, profile.territory, profile.active]);
  const isSelf = profile.uid === currentUid;
  const save = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const authorizationError = authorizationUpdateError(managerProfile, currentUid, profile.uid, profile, { role, active });
      if (authorizationError) throw new Error(authorizationError);
      await onSave(profile.uid, { role, territory, active });
      if (mounted.current) onClose();
    } catch (e) {
      if (mounted.current) setSaveError(e.message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  return h("div", { style: { marginTop: 20, border: "1px solid #B8894C", borderRadius: 8, padding: 20 } },
    h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, marginBottom: 8 } }, "Edit Authorization Profile"),
    h("div", { style: { color: "#C9CFD6", marginBottom: 16 } }, profile.displayName || profile.email || profile.uid),
    h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 } },
      h("label", { style: { fontFamily: "'Oswald', sans-serif", color: "#8A93A0" } }, "Role",
        h("select", { "aria-label": "Authorization role", value: getAssignableRoles(managerProfile).includes(role) ? role : "", disabled: saving || isSelf, onChange: (e) => setRole(e.target.value), style: userFieldStyle },
          !getAssignableRoles(managerProfile).includes(role) && h("option", { value: "" }, "Select an allowed role"),
          getAssignableRoles(managerProfile).map((value) => h("option", { key: value, value }, ROLE_LABELS[value]))
        )
      ),
      h("label", { style: { fontFamily: "'Oswald', sans-serif", color: "#8A93A0" } }, "Territory",
        h("input", { value: territory, disabled: saving, onChange: (e) => setTerritory(e.target.value), style: userFieldStyle })
      ),
      h("label", { style: { fontFamily: "'Oswald', sans-serif", color: "#8A93A0" } }, "Status",
        h("select", { "aria-label": "Authorization status", value: active ? "active" : "disabled", disabled: saving || isSelf, onChange: (e) => setActive(e.target.value === "active"), style: userFieldStyle },
          h("option", { value: "active" }, "Active"),
          h("option", { value: "disabled" }, "Disabled")
        )
      )
    ),
    isSelf && h("div", { style: { color: "#8A93A0", fontSize: 12, marginTop: 12 } }, "You cannot change your own role or disable your own profile."),
    saveError && h("div", { role: "alert", style: { color: "#d98a7c", marginTop: 12 } }, saveError),
    h("div", { style: { display: "flex", gap: 10, marginTop: 16 } },
      h("button", { className: "hg-btn", disabled: saving || !isValidRole(role), onClick: save, style: { ...userButtonStyle, background: "#B8894C", color: "#14161A" } }, saving ? "Saving…" : "Save Profile"),
      h("button", { className: "hg-btn", disabled: saving, onClick: onClose, style: userButtonStyle }, "Cancel")
    )
  );
}

export function AuthorizedUsers({ currentUid, managerProfile, requirePermission, onSave, onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [ready, setReady] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [editingUid, setEditingUid] = useState(null);
  useEffect(() => {
    if (!requirePermission("canManageUsers")) return;
    let listening = true;
    const unsubscribe = subscribeAuthorizedUsers((profiles) => {
      if (!listening) return;
      setProfiles(profiles);
      setUsersError("");
      setReady(true);
    }, (e) => {
      if (!listening) return;
      setProfiles([]);
      setEditingUid(null);
      setUsersError("Could not load authorization profiles. (" + e.message + ")");
      setReady(true);
    });
    return () => { listening = false; unsubscribe(); };
  }, [currentUid, requirePermission]);
  const editingProfile = profiles.find((p) => p.uid === editingUid);
  useEffect(() => {
    if (editingUid && !canManageAuthorizationProfile(managerProfile, editingProfile)) {
      setEditingUid(null);
      setUsersError("You are no longer authorized to edit this authorization profile, or it no longer exists.");
    }
  }, [editingUid, editingProfile, managerProfile]);
  const openProfileEditor = (profile) => {
    if (!requirePermission("canManageUsers") || !canManageAuthorizationProfile(managerProfile, profile) ||
        (profile.role === "owner" && !requirePermission("canManageOwners"))) {
      setUsersError("You are not authorized to edit this authorization profile.");
      return;
    }
    setUsersError("");
    setEditingUid(profile.uid);
  };
  return h("div", { style: { maxWidth: 1000, margin: "0 auto", padding: 24 } },
    h("button", { className: "hg-btn", onClick: onClose, style: userButtonStyle }, h(ArrowLeft, { size: 14 }), " Back to list"),
    h("div", { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 32, marginTop: 20 } }, "Authorized Users"),
    h("p", { style: { color: "#8A93A0", fontSize: 13 } }, "Manage existing Firestore authorization profiles. Changes take effect live. This screen does not create, disable, or modify Firebase Authentication accounts."),
    usersError && h("div", { role: "alert", style: { color: "#d98a7c", marginBottom: 16 } }, usersError),
    !ready ? h("div", { style: { color: "#8A93A0" } }, "Loading authorization profiles…") :
      h("div", { className: "hg-scroll", style: { overflowX: "auto", border: "1px solid #3B2A1E", borderRadius: 8 } },
        h("table", { style: { width: "100%", minWidth: 650, borderCollapse: "collapse", textAlign: "left", fontFamily: "'Oswald', sans-serif", fontSize: 13 } },
          h("thead", { style: { background: "#1B1E22", color: "#B8894C" } },
            h("tr", null, ["Name", "Email", "Role", "Territory", "Status", ""].map((label, i) => h("th", { key: i, scope: "col", style: { padding: 12 } }, label)))
          ),
          h("tbody", null, profiles.map((profile) =>
            h("tr", { key: profile.uid, style: { borderTop: "1px solid #2c3036" } },
              h("td", { style: { padding: 12 } }, profile.displayName || "—", profile.uid === currentUid ? " (you)" : ""),
              h("td", { style: { padding: 12 } }, profile.email || "—"),
              h("td", { style: { padding: 12 } }, isValidRole(profile.role) ? ROLE_LABELS[profile.role] : "Unknown role"),
              h("td", { style: { padding: 12 } }, profile.territory || "—"),
              h("td", { style: { padding: 12, color: profile.active === true ? "#B8894C" : "#d98a7c" } }, profile.active === true ? "Active" : "Disabled"),
              h("td", { style: { padding: 12 } }, canManageAuthorizationProfile(managerProfile, profile) && h("button", { className: "hg-btn", onClick: () => openProfileEditor(profile), style: userButtonStyle }, "Edit"))
            )
          ))
        ),
        !profiles.length && !usersError && h("div", { style: { padding: 16, color: "#8A93A0" } }, "No authorization profiles found.")
      ),
    canManageAuthorizationProfile(managerProfile, editingProfile) && h(AuthorizationProfileEditor, { key: editingProfile.uid, profile: editingProfile, currentUid, managerProfile, onSave, onClose: () => setEditingUid(null) })
  );
}
