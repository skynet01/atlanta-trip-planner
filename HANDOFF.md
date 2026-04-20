# Atlanta Trip Planner — Handoff

## Current goal
Add lightweight session auth/sharing so the planner is no longer one global shared state.

## User requirements
- First visit gets a browser UID.
- Same browser should auto-load its session.
- User can save/protect a session with a passphrase.
- Incognito/new browser can load a session with UID + passphrase.
- Session can be shared so multiple people edit the same planner.
- Keep it simple and pragmatic for ~100 users during a conference week.

## Progress log
- Initialized git repo.
- Created initial snapshot commit: `5c0342d` (`chore: initial snapshot`).
- Inspected current app structure: one HTML app + one small Express/Socket.IO/SQLite server.
- Reworked `server.js` toward per-session storage instead of one global `main` state.
- Added `package.json` and `.gitignore`.
- Added frontend session scaffolding in `atlanta-trip-planner.html`:
  - auth/cache helpers
  - `SessionBar` UI
  - `App()` refactor started for browser UID, passphrase, local cache, hydrate, autosave, join flow, and live socket sync
- Added inline comments in the session code paths to make follow-up changes easier.

## What should work conceptually now
- Browser UID is persisted locally.
- Passphrase is persisted locally for same-browser auto-load convenience.
- Session save/join UI is present in the planner.
- Backend contract now supports per-session GET/POST plus socket room broadcast.

## Remaining work
1. Install npm dependencies.
2. Run syntax/runtime verification.
3. Fix any frontend bugs from the `App()` refactor.
4. Verify two-session shared editing behavior in browser.
5. Commit checkpoint once app is running.

## Notes
- This is intentionally lightweight, not secure production auth.
- Local passphrase storage is a deliberate convenience tradeoff for this short-lived conference app.
