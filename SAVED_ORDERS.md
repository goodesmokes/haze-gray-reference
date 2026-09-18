# Saved Orders / Retailer Order History — Firebase Spark

## Production architecture and cost

The browser uses the existing Firebase Authentication and Cloud Firestore SDK. No Cloud Functions, Cloud Run, Cloud Build or Artifact Registry is used or required by this feature. Firebase Spark is sufficient within its Authentication/Firestore quotas; no billing account or payment method is required for this design. Quota exhaustion can interrupt saves/reads, so monitor usage. This work does not change the project's actual billing plan.

The explicit default project in .firebaserc remains haze-gray-cigars. firebase.json configures Firestore rules/indexes and local Auth/Firestore emulators only. No Hosting configuration is added. Publishing the single-file client still uses the existing site's hosting process.

Official plan information: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans

## Saving an internal reference order

The active Order Builder, Final Review calculations, email/copy output and haze-gray-cigars.order-draft.v1 storage key/format remain unchanged. Saved snapshots retain schemaVersion 1, status saved, retailer display/normalized names, email, notes, creator identity, savedAt, lineItems and totals. Every line retains explicit cigarId, sizeKey and packKey plus historical names, quantities, prices and calculated values. No retailer collection or migration is introduced.

A save validates the captured draft, persists a generated order ID and payload in haze-gray-cigars.pending-order-save.v1.{uid}, then runs a Firestore transaction. The transaction checks orders/{orderId} first. An existing record belonging to that UID confirms the prior save without rewriting it, even after catalog changes. An ID belonging to another creator fails. For an unused ID, it reads the current authorization profile, validates/canonicalizes the snapshot, checks product/size/package availability against the client's current catalog, and writes savedAt with serverTimestamp(). Rules enforce create-only access. Concurrent retries retain the same ID and produce one record; updates are denied.

The UI shows captured-versus-current wholesale price differences before saving. Saved history uses captured draft prices; it does not automatically reprice the active draft. This is client-side validation, not independent server verification. A rejected capture can explicitly be replaced with the current draft under the SAME pending ID. If that ID already succeeded, its original record remains unchanged. Network failures never automatically allocate a replacement ID. Do not manually clear pending receipts during uncertain saves. Firestore transactions require an online connection; retry after reconnecting.

Saving does not send email, submit, fulfill or collect payment. Success offers Continue Editing Current Order or an explicit Start New Order action. The active draft is never cleared merely because a save succeeded. Signing out preserves the local draft and pending receipts.

## Validation and security boundary

The client permits 1–100 distinct order lines, integer quantities 1–1,000,000, finite nonnegative unit values/wholesale/retail totals up to 1 billion, retailer/email lengths up to 500, notes up to 10,000, bounded line strings, and snapshots at most 900,000 UTF-8 JSON bytes. Gross profit and margin can legitimately be negative. It validates current product/size/package availability and reports price differences without changing captured prices.

Firestore rules independently enforce:

- An existing, active Owner/Admin/Field Rep profile for creation.
- creatorUid equals the authenticated UID; creatorDisplayName matches that profile.
- Exact top-level fields, schemaVersion 1, status saved and savedAt equal to request.time.
- Basic top-level string types/lengths, a nonempty list of at most 100 lines, and bounded numeric totals with a matching lineCount.
- Owner/Admin reads of all history; Field Rep reads of their own records; no order access for Viewer, inactive, unknown or signed-out accounts.
- Denial of every update/delete, including Owner/Admin. Privileged console/admin operations remain outside browser rules.

Authorized users may get an unused order ID so their transaction can check existence. This returns no document data and does not allow a Field Rep to read another creator's existing order.

Rules do NOT iterate over line items, look up catalog pricing, recalculate totals, verify every line field or enforce the browser's byte limit. An authorized user bypassing the app can submit fabricated line values or inconsistent totals within the shallow rules. These immutable records establish who recorded a snapshot and when; they are internal sales/reference history, NOT tamper-proof accounting records. No independent price verification or App Check/rate limiter has been introduced. Existing catalog and Authorized Users rules remain unchanged.

## History, index and reorder

History is newest-first with case-insensitive retailer search and stored historical details. Missing retailer names have a fallback label. Listener errors clear protected results and offer retry. Sign-out, revoked access and role changes unmount protected views and unsubscribe listeners; the draft remains available locally.

Because rules intentionally use shallow validation, history checks incoming record shapes before rendering. Malformed records are omitted with a visible error; their stored data is never rewritten.

The Field Rep query still needs the orders collection index creatorUid ASC + savedAt DESC in firestore.indexes.json. Owner/Admin's savedAt DESC query uses a normal single-field index. History currently listens to all accessible orders; growing history increases read usage and memory. No fabricated analytics or additional persisted retailer fields are added.

Reorder matches cigarId → sizeKey → packKey. Available configurations use CURRENT prices from the client catalog. Missing configurations are named and require acknowledgement before a partial reorder. Historical documents are unchanged. Replace/Add/Cancel protects an existing draft, including contact/notes-only drafts. Add retains active retailer/email/notes and unrelated lines; matching configurations merge quantities and reprice the combined line. Different size/package keys stay separate.

## Local tests and future release

Development-only dependencies are in the root package.json/pnpm-lock.yaml: the browser Firebase SDK and Babel parser/traverse. No server deployment package remains. Use Node 22 or newer, pnpm, Firebase CLI and Java 21 for local testing. Install with pnpm install --frozen-lockfile.

The test-only umbrella Firebase SDK includes unused Functions client modules transitively. They are not imported by the app or tests, configure no backend, and require no billing service. No firebase-admin or firebase-functions server runtime remains.

Start local emulators with firebase emulators:start --only auth,firestore --project demo-haze-gray-orders. Then in PowerShell:

    $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085'
    $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
    $env:GCLOUD_PROJECT = 'demo-haze-gray-orders'
    pnpm test

The integration suite is safety-gated to those local endpoints and demo project. It creates test Auth accounts, seeds profiles/catalog through emulator-only REST access, then exercises browser SDK operations with real emulator authentication and security rules. Production data is never used. Unit/client tests cover snapshots, boundaries, preserved helpers, current-price reorder, missing configurations and source-record integrity. Rules comparisons normalize the orders section on both sides so the test works before and after committing this feature.

Before a separately approved release, verify production project access and existing indexes/rules. Publish the required index and wait until ready, publish the reviewed create-only order rules, then release the client through its existing host. No function deployment or billing upgrade is needed. Until those rules are released, current production rules may reject direct saves. Retest live role access, network-loss retries, reloads, mobile layouts, and sign-out/role revocation. No deploy, commit or push is part of this change.

## Validation completed September 18, 2026

The complete Node suite with official Auth and Firestore emulators passed: 14 passed, 0 failed, 0 skipped. This includes successful realistic 100-line saves, rejection of 101 lines, identity/timestamp/role checks, immutable records, restricted reads, concurrent same-ID retries, malformed history guards and original application preservation checks. git diff --check passed; Git only reported normal Windows LF-to-CRLF notices.

Browser smoke testing against local emulators passed for detail Add to Order, save confirmation without draft clearing, case-insensitive retailer search, stored historical pricing after a catalog price change, current-price reorder, Cancel/Add/Replace, draft reload, Authorized Users access, and sign-out/live role-loss history cleanup. These browser checks are separate from the 14 automated tests. Mobile devices, real interrupted-network retries, and production index readiness still require manual testing after a separately approved release. Emulator queries do not establish that a production composite index is deployed and ready.
