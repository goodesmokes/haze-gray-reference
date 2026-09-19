# Saved Orders / Retailer Order History — Firebase Spark

## Production architecture and cost

The browser uses the existing Firebase Authentication and Cloud Firestore SDK. No Cloud Functions, Cloud Run, Cloud Build or Artifact Registry is used or required by this feature. Firebase Spark is sufficient within its Authentication/Firestore quotas; no billing account or payment method is required for this design. Quota exhaustion can interrupt saves/reads, so monitor usage. This work does not change the project's actual billing plan.

The explicit default project in .firebaserc remains haze-gray-cigars. firebase.json configures Firestore rules/indexes and local Auth/Firestore emulators only. No Hosting configuration is added. Publishing the single-file client still uses the existing site's hosting process.

Official plan information: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans

## Saving an internal reference order

The active Order Builder, Final Review calculations, email/copy output remain unchanged. Active drafts now use haze-gray-cigars.order-draft.v2.<uid>, retaining the same draft fields. Saved snapshots retain schemaVersion 1, status saved, retailer display/normalized names, email, notes, creator identity, savedAt, lineItems and totals. Every line retains explicit cigarId, sizeKey and packKey plus historical names, quantities, prices and calculated values. Retailer profiles now live in a separate shared retailers collection; no existing orders are migrated.

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

## User-scoped active drafts

Draft state starts empty. Auth account changes immediately clear in-memory items, retailer, email and notes and close protected order/history views. Only a resolved active Owner/Admin/Field Rep profile restores the authenticated UID's v2 draft. Viewer, inactive, unknown and signed-out sessions never restore drafts. Role loss and profile-listener errors clear memory without deleting the persisted draft. Persistence checks the draft owner, current Auth UID and current authorization before writing.

The old unscoped haze-gray-cigars.order-draft.v1 entry is left untouched and is never read or automatically assigned to a user. It contains no reliable owner UID; any future recovery needs independently established ownership. Pending-save receipts remain UID-scoped and are preserved locally; their UI state unmounts on account/permission transitions. Saved Order records and Firestore rules are unchanged by this isolation fix.

## Retailer Profiles / Customer Directory (not deployed)

Retailers use retailers/{retailerId}. Each document contains schemaVersion (1), active (boolean), name, nameNormalized, contactName, email, phone, address1, address2, city, state, postalCode, country, website, notes, creatorUid, creatorDisplayName, createdAt and updatedAt. Text fields are trimmed; fields are limited to 500 characters, customer notes to 5,000, normalized names to 1,500 and UIDs to 128. Names are required. Optional email is format-checked in the client. New profiles start active; createdAt/updatedAt use server timestamps. Creator UID/display name, schemaVersion and createdAt remain immutable for all browser users.

Active Owner/Admin users read and edit all retailers and may change active status. Active Field Reps read/edit active retailers and may create active profiles; they cannot change active status or audit identity. Viewer, inactive, unknown, missing-profile and signed-out users have no directory access. Hard delete is denied for all browser users. No subcollections, contacts collection, payment data or accounting features are added.

The live directory sorts names A–Z and searches name/contact/city/state locally. Field Rep reads use active == true. Owner/Admin reads use the collection directly. Creation checks active normalized-name duplicates and offers Open Existing Retailer. This is an advisory check: simultaneous clients can still race, and rules do not enforce name uniqueness. Updates do not merge profiles.

Order Builder offers saved-retailer selection or manual entry. Selecting copies name/email without customer notes. A linked draft uses captured name/email; switch to manual entry to edit them and clear the link. Inactive/missing links show a warning without discarding the draft. Starting an order from a profile reuses the builder and requires Replace Current Order or Cancel if any meaningful draft exists.

The existing UID-scoped v2 draft adds retailerId, cleared and restored with the rest of the draft on authorized account transitions. Legacy v1 storage remains untouched. New saved orders optionally include retailerId (nonempty string, at most 128 characters, no slash); manual orders omit it. Rules add only this optional create field and no retailer lookup. Existing order read permissions and update/delete denial remain unchanged. Historical display always uses order snapshots, never current profile values. Reorder Replace carries the historical retailer link; Add keeps the current draft link.

View Linked Orders filters the already-authorized history by exact retailerId. Field Reps still see only their own orders, even from a shared profile. Legacy unlinked orders remain in normal history/name search; no identity is guessed and no history is rewritten. Order detail can open a linked profile, with inactive/missing/unavailable handling.

No new composite indexes are needed: directory equality queries use standard indexes; sorting/search and exact-ID history filtering run client-side. The existing orders creatorUid ASC + savedAt DESC index remains unchanged. Directory/history listeners read all records available to their role; read usage grows with the directory/history size.

This enhancement uses the existing Firebase web SDK, Auth and Firestore only. Firebase Spark is sufficient within quotas, with no payment method or Blaze-only services required. No deployment configuration or dependencies were added. Production rules do not yet grant retailers access or permit retailerId on new orders. Manual testing against production requires a separately approved rules release; local emulator testing can proceed now.

Automated validation: 22 passed, 0 failed, 0 skipped, including official Auth/Firestore emulator tests. Coverage includes retailer permissions, timestamps/audit immutability, duplicates/search, builder handlers, optional linked snapshots, unchanged order rules, UID-scoped retailer selection, role/sign-out cleanup and existing app preservation. Manually recheck phone/tablet layout, active/inactive transitions while editing or ordering, duplicate warnings, account switching, profile changes without historical rewrites, manual orders and linked reorders.

## Retailer Assignment (uncommitted; not deployed)

Retailers may now include `assignedRepUids: string[]`. Missing means `[]` (Unassigned). Schema version remains 1; no migration is required. Lists accept at most 10 unique, nonempty UID strings (maximum 128 characters, no slash). Only UID identifiers are stored: no copied rep names, emails, roles or status.

Assignment represents responsibility, not directory access or order ownership. Owner/Admin still see all retailers; Field Reps still see every active retailer and may order for any of them. Existing `/users`, `/orders`, `/cigars`, legacy and catch-all rules are unchanged. No new index is needed: assignment filters operate on the existing authorized directory dataset. The existing orders index and Firebase configuration are unchanged.

Owner/Admin can assign active Field Reps during creation or open **Edit Assigned Reps** on a retailer profile without editing contact information. Assignment-only transactions update just `assignedRepUids` and `updatedAt`, recheck the editor's current authorization, reject conflicting concurrent assignment edits, and read newly selected user profiles to verify current active Field Rep status. Existing stale assignments remain stored and may be manually removed. A stale/inactive user cannot be newly added through the client. Regular contact edits do not send an assignment field, preventing them from overwriting a newer assignment.

The retailer rules allow assignment changes only by active Owner/Admin. Field Rep creates may omit the field or supply `[]`; the app always creates them with `[]`. Field Rep updates must leave the field exactly unchanged, including its presence/absence and list order. A Field Rep cannot add even an empty field to a legacy document, remove the field, or assign themselves. Validation covers every list entry without per-assignee document lookups. Rules trust Owner/Admin to select eligible reps; a manager bypassing the client could store another syntactically valid UID. This is the explicit client-choice validation boundary, not a new user-profile read permission.

Owner/Admin resolve names/status with a manager-only live users listener. They see unavailable or former/inactive labels when appropriate, and may filter All/Assigned/Unassigned or by an available rep profile. Field Reps never start that users listener or read another profile: they see **You**, **Other assigned rep**, and assignment counts. My Retailers matches the current UID and defaults on when assignments exist. With no assignments, the directory shows an explanatory message and All Active Retailers; shared access always remains available. Protected views and profile state clear on account/role transitions and sign-out. Profile-listener failures clear resolved identities and offer Retry; stored assignment UIDs and unsaved assignment choices are never silently cleared.

This feature uses the existing Authentication and Firestore client services only. Firebase Spark remains sufficient within quotas, with no payment method, billing upgrade, new backend, paid search, or new dependencies required. Assignment writes require a separately approved release of the updated retailer rules before testing against production. Nothing in this implementation deploys them automatically.

Manual checklist: Owner and Admin assign one/multiple reps, remove one/all, create assigned/unassigned retailers, and filter Assigned/Unassigned/specific rep. Make an assigned rep inactive/change role and verify the stored UID remains, the manager sees a stale status, and that user cannot be newly selected. Field Rep checks My/All, anonymous labels, unassigned creation, allowed contact edits, and absence of assignment controls. Recheck account switching, sign-out/live role loss, long names/lists on phone/tablet, existing city/state search and phone formatting, and Start New Order/draft protection/reorder for a retailer assigned to someone else.

Validation: the complete automated suite passed 35 tests, 0 failed, 0 skipped, using local Auth/Firestore emulators. Valid 10-assignment creates, updates, client transactions, and Field Rep contact edits pass; invalid UID types at every slot, duplicates and 11-assignment writes are rejected. The assignment validator was reduced to avoid the Firestore expression limit. Browser smoke checks on an emulator-only copy passed Owner multi-rep saving, Field Rep My/All defaults and privacy labels, starting an order for an unassigned retailer, and account switching/sign-out. Live production and device-layout checks remain manual.
