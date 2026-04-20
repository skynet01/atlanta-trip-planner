# Atlanta Trip Planner — Handoff

## Current goal
Add lightweight session auth/sharing so the planner is no longer one global shared state.

## User requirements
- First visit gets a popup on first meaningful interaction asking to create or load a session.
- Returning users should auto-load without the popup.
- New session should show a UID + recovery pass.
- Same browser should auto-return to the saved owner session.
- Share action should open a modal with a copyable link.
- Anyone with the shared link can collaborate without a pass.
- Shared-link users can branch off and create their own separate session.
- Page title/header should use `UX360 Summit`.
- Keep it simple and pragmatic for ~100 users during a conference week.

## Progress log
- Initialized git repo.
- Created initial snapshot commit: `5c0342d` (`chore: initial snapshot`).
- Added first shared-session scaffold commit: `a540fed` (`feat: scaffold lightweight shared sessions`).
- Added verification/dependency commit: `c924a11` (`chore: verify session auth setup`).
- Reworked server storage model again to better match the desired UX:
  - owner UID + passphrase recovery
  - separate share token + share URL for collaborator access without passphrase
  - create/load/share/save endpoints aligned to that flow
- Reworked frontend session UX in `atlanta-trip-planner.html`:
  - first-interaction session chooser modal
  - owner recovery flow
  - share modal with copyable link
  - shared-link auto-load flow
  - “create my own session” branch-off flow
  - title/header renamed to `UX360 Summit`
- Added/kept inline comments around session logic to make follow-up debugging easier.
- Installed `playwright-core` as a dev dependency for real local browser verification.

## Verification completed
- `node --check server.js` passes.
- Local app server starts successfully with `npm start`.
- Verified backend APIs for create/load/save behavior earlier in the session.
- Verified the updated browser flow with a real Playwright + Brave run against localhost:
  1. Fresh user clicks a control.
  2. Session chooser modal opens.
  3. User creates a session and sees UID + pass.
  4. Share modal exposes a share link.
  5. Second browser opens share link without pass.
  6. Second browser edits planner and first browser receives the update.
  7. Shared-link user creates their own session.
  8. New edits stay isolated from the original shared session.

## Current state
- Main session/sharing flow is working locally.
- Local server process was started during testing and may still be running.
- `playwright-core` was added to `package.json` for future localhost QA.

## Remaining polish ideas
- Reduce the number of autosave calls during initial shared-session hydration.
- Improve the visual formatting of UID/pass display in the create-session success block.
- If desired later, add a dedicated “Done” button to the session chooser after creation.

## Notes
- This is intentionally lightweight, not secure production auth.
- Local passphrase storage is a convenience tradeoff for this short-lived conference app.
- Shared-link collaborators do not need the passphrase; the pass is only for owner recovery from a different browser/incognito.

## Deployment
- **Production host:** Oracle Cloud Ubuntu ARM instance at `ubuntu@161.153.60.47` (`instance-20260303-0858`).
- **App dir:** `/opt/trip-planner/`. Runs under pm2 as `trip-planner`, listening on `127.0.0.1:3456` with base path `/atlanta-trip` (fronted by an existing reverse proxy).
- **Deploy procedure:** `scp server.js atlanta-trip-planner.html package.json` into `/opt/trip-planner/`, `npm install --omit=dev`, `pm2 restart trip-planner`. `better-sqlite3` is a native binding — always run `npm install` on the server so the binary is rebuilt for ARM.
- **DB:** `/opt/trip-planner/trip-planner.db` (SQLite, WAL mode). Back up the `.db`, `.db-shm`, `.db-wal` trio together.
- **Previous deploy (2026-04-20) backup:** `/opt/trip-planner.bak-20260420-100420/` — contains the pre-session-auth single-`state`-row schema. Safe to delete once confirmed no salvage is needed.
- **GitHub origin:** `git@github.com:skynet01/atlanta-trip-planner.git` (public).
