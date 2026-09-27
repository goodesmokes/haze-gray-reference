# Vendored browser runtime

These files are exact browser artifacts used by the Haze Gray Reference app's
offline executable shell. They are committed so application startup does not
depend on a third-party CDN after the service worker has installed the shell.

Do not replace a file in place. Update its versioned directory, source URL,
SHA-256 value, import map entries, service-worker cache version, and tests in
the same change.

| Dependency | File | Original source URL | SHA-256 |
| --- | --- | --- | --- |
| Babel Standalone 7.24.7 | `babel/7.24.7/babel.min.js` | `https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.24.7/babel.min.js` | `d9e33722fdfba37e4e428aa72cb58da65f18358bfb229e136dfc1285e76b03ff` |
| React 18.3.1 | `react/18.3.1/react.mjs` | `https://esm.sh/react@18.3.1/es2022/react.mjs` | `fec8d5ab4ffa55c8b563abc31060c3dc0205699aff20beec4aba0311efdcc1a0` |
| ReactDOM client 18.3.1 | `react-dom/18.3.1/client.mjs` | `https://esm.sh/react-dom@18.3.1/es2022/client.mjs` | `d68545ce29e9d2dd03261912eaf97e5f81469e9a9a7edcab3a91da6093d17606` |
| ReactDOM 18.3.1 | `react-dom/18.3.1/react-dom.mjs` | `https://esm.sh/react-dom@18.3.1/es2022/react-dom.mjs` | `8d74245ed18f92dd4df0299b26a53dd6015f91beedf6cdef49463ba4e3063909` |
| Scheduler 0.23.2 | `scheduler/0.23.2/scheduler.mjs` | `https://esm.sh/scheduler@0.23.2/es2022/scheduler.mjs` | `8a1a8a363eb417fc8d40f6b15132e8964320782d7169e68fc6ac98b8b8c201eb` |
| Lucide React 0.383.0 | `lucide-react/0.383.0/lucide-react.mjs` | `https://esm.sh/lucide-react@0.383.0/X-ZXJlYWN0/es2022/lucide-react.mjs` | `0ec124976f559a85980bb276524e2444928a5f2afcbd7dadc7907102d12b95c1` |
| Firebase App 10.12.2 | `firebase/10.12.2/firebase-app.js` | `https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js` | `08b83f02859328aabb9acea9370d600ffe739d9e2c251b6668b6f6ff56a2e1d1` |
| Firebase Auth 10.12.2 | `firebase/10.12.2/firebase-auth.js` | `https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js` | `9b2ebba6ffced4657e12300f4187d53c8fc1762e98188e5e2005407a86e926b6` |
| Firebase Firestore 10.12.2 | `firebase/10.12.2/firebase-firestore.js` | `https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js` | `aecb2b5b722d1a45426326cd144bc025d5bea8c48f3a53eca3914ad587361bd4` |

The ReactDOM artifact imports the audited React and Scheduler specifiers, and
the Firebase Auth and Firestore artifacts import the audited Firebase App URL.
The application import map redirects those exact specifiers to the local files;
the vendored artifact bytes remain unchanged.

License and attribution details are recorded in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
