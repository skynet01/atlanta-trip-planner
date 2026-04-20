# UX360 Summit — Atlanta Trip Planner

A lightweight collaborative trip planner built for the UX360 Summit conference week in Atlanta. Attendees can browse themed itinerary options by day (food, outdoors, culture, nightlife, etc.), check off what they want to do, and share their plan with friends via a copy-paste link.

This is intentionally small: a single-file React app served by a small Express backend, with SQLite for persistence and Socket.IO for live sync between collaborators. No build step, no accounts, no third-party services required.

## Features

- **Day-by-day itinerary** with activities tagged by theme and Atlanta region.
- **Lightweight session model** — no email signup. Each plan gets a random owner UID and a recovery passphrase on creation.
- **Share links** — owners can hand collaborators a URL that loads the plan without needing the passphrase.
- **Branch-off** — anyone viewing a shared plan can spin up their own independent session.
- **Live sync** — edits propagate to other viewers of the same session over WebSockets.
- **Single-file frontend** — React + Tailwind via CDN, no bundler.

## Tech stack

- Node.js 20+
- Express 4
- Socket.IO 4
- better-sqlite3 (WAL mode)
- React 18 + Tailwind (served from unpkg/CDN, no build required)

## Quick start (local)

```bash
git clone git@github.com:skynet01/atlanta-trip-planner.git
cd atlanta-trip-planner
npm install
npm start
```

The server listens on `http://127.0.0.1:3456/atlanta-trip`. Open that URL in a browser.

On first interaction the app shows a session chooser:
- **Create a new session** — you get a UID + passphrase. Save them; the passphrase is the only way to recover your session from a different browser.
- **Load an existing session** — enter your UID + passphrase.

The owner can open the share modal and copy a link that lets others view and edit the same plan without a passphrase.

## How sessions work

- **Owner UID + passphrase** are generated server-side on session creation. The passphrase is salted+hashed with scrypt; it is never stored in plaintext.
- **Share token** is a separate random string embedded in the share URL (`/atlanta-trip?share=<token>`). Possessing the token grants read/write access to the state but does not grant owner recovery.
- **Branch-off** copies the current state into a fresh session with new credentials, leaving the original untouched.
- All state is JSON blobs in a single SQLite table (`sessions`). No per-field schema.

This is **not production-grade auth**. Anyone with a share link can edit. Anyone with a UID + passphrase is the owner. Designed for a short-lived conference use case, not for sensitive data.

## Project layout

```
server.js                    Express + Socket.IO backend; SQLite storage
atlanta-trip-planner.html    Single-file React app served for every route
package.json                 Dependencies + `npm start`
trip-planner.db              SQLite database (created on first run)
```

## API

All routes are prefixed with `/atlanta-trip`.

| Method | Path                         | Purpose                                               |
|--------|------------------------------|-------------------------------------------------------|
| GET    | `/`                          | Serve the app HTML                                    |
| POST   | `/api/session/create`        | Create a new session; returns uid, passphrase, shareToken |
| GET    | `/api/session?uid=&pass=`    | Load an owner session                                 |
| GET    | `/api/share/:shareToken`     | Load a session via its share token                    |
| POST   | `/api/session/save`          | Save state (owner creds OR share token)               |
| WS     | `/socket.io`                 | Live sync; join with `{ uid }`                        |

## Production deployment

The app runs well on any Linux host with Node 20+. A typical setup:

1. Clone into a deploy directory (e.g. `/opt/trip-planner`).
2. `npm install --omit=dev` to install production dependencies. **`better-sqlite3` is a native module — always run `npm install` on the target host** so the binary is built for the host's architecture. Reinstalling is also required after every deploy to a different CPU arch (e.g. x86_64 → arm64).
3. Run under a process manager. Example with pm2:

   ```bash
   pm2 start server.js --name trip-planner
   pm2 save
   ```

4. Place behind a reverse proxy (nginx, Caddy, etc.) that forwards `/atlanta-trip` to `127.0.0.1:3456`. Make sure to enable WebSocket upgrades for Socket.IO:

   ```nginx
   location /atlanta-trip/ {
       proxy_pass http://127.0.0.1:3456;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

### Configuration

Port and base path are hardcoded in `server.js` (`PORT = 3456`, `BASE_PATH = '/atlanta-trip'`). Change them there if you need to host elsewhere; the frontend's Socket.IO connect URL also points at `/atlanta-trip/socket.io/` and must match.

### Backups

Back up the `trip-planner.db`, `trip-planner.db-shm`, and `trip-planner.db-wal` files together — the WAL file holds uncheckpointed writes and restoring the `.db` alone can lose recent edits.

## Development notes

- There is no test suite. The flow was verified manually (Playwright + a real browser) across create / share / collaborate / branch-off paths.
- `playwright-core` is included as a dev dependency for local end-to-end checks.
- The React code lives inline in `atlanta-trip-planner.html` and is transpiled in-browser by Babel standalone — fine for a conference-scale app, not recommended for anything larger.

## Caveats

- Passphrases are shown once at creation time and are never recoverable. Lose it and you lose owner access to that session (collaborators with the share link can still edit).
- No rate limiting, no abuse controls. Suitable for a known audience on a trusted network, not for the open internet without additional protections.
- State size is capped at 3 MB per request (`express.json({ limit: '3mb' })`). Plenty for the intended use; tweak if you need larger payloads.

## License

Released under the [MIT License](LICENSE).
