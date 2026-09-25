// Installation foundation only: this does not make the application offline-ready.
const APP_SCOPE = "/haze-gray-reference/";

function registerPwa() {
  navigator.serviceWorker.register(`${APP_SCOPE}sw.js`, {
    scope: APP_SCOPE,
    updateViaCache: "none"
  }).catch((error) => {
    // Registration failure must not prevent normal application use.
    console.warn("Haze Gray PWA registration failed:", error);
  });
}

if (window.isSecureContext && "serviceWorker" in navigator && window.location.pathname.startsWith(APP_SCOPE)) {
  if (document.readyState === "complete") registerPwa();
  else window.addEventListener("load", registerPwa, { once: true });
}
