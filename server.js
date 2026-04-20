const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const PORT = 3456;
const BASE_PATH = '/atlanta-trip';
const APP_FILE = path.join(__dirname, 'atlanta-trip-planner.html');

// Simple SQLite storage for a short-lived conference app.
// We keep one row per planner session with:
// - uid: owner/recovery identifier
// - pass hash: lets the creator recover from incognito/new browser
// - share_token: powers a copy/paste share link that collaborators can use without a pass
const db = new Database(path.join(__dirname, 'trip-planner.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  uid TEXT PRIMARY KEY,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  share_token TEXT UNIQUE NOT NULL,
  data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

const tableColumns = db.prepare(`PRAGMA table_info(sessions)`).all().map((col) => col.name);
if (!tableColumns.includes('share_token')) {
  db.exec(`ALTER TABLE sessions ADD COLUMN share_token TEXT`);
}

function randomId(prefix, size = 10) {
  return `${prefix}${crypto.randomBytes(size).toString('hex').slice(0, size)}`;
}

function hashPass(pass, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPass(pass, salt, hash) {
  if (!pass || !salt || !hash) return false;
  const attempt = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(hash, 'hex'));
}

function safeParseState(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function getSessionByUid(uid) {
  return db.prepare('SELECT * FROM sessions WHERE uid = ?').get(uid) || null;
}

function getSessionByShareToken(shareToken) {
  return db.prepare('SELECT * FROM sessions WHERE share_token = ?').get(shareToken) || null;
}

function sanitizeSession(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    shareToken: row.share_token,
    shareUrl: `${BASE_PATH}?share=${encodeURIComponent(row.share_token)}`,
    state: safeParseState(row.data),
    updatedAt: row.updated_at,
  };
}

function createSession(state) {
  const uid = randomId('u-');
  const passphrase = randomId('p-', 12);
  const shareToken = randomId('s-', 16);
  const { salt, hash } = hashPass(passphrase);
  const serialized = JSON.stringify(state);

  db.prepare(
    `INSERT INTO sessions (uid, pass_salt, pass_hash, share_token, data, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(uid, salt, hash, shareToken, serialized);

  const created = getSessionByUid(uid);
  return {
    uid,
    passphrase,
    shareToken,
    shareUrl: `${BASE_PATH}?share=${encodeURIComponent(shareToken)}`,
    state: safeParseState(created.data),
  };
}

function loadOwnerSession(uid, passphrase) {
  const row = getSessionByUid(uid);
  if (!row) return { ok: false, status: 404, error: 'Session not found' };
  if (!verifyPass(passphrase, row.pass_salt, row.pass_hash)) {
    return { ok: false, status: 401, error: 'Wrong passphrase' };
  }
  return { ok: true, session: sanitizeSession(row) };
}

function loadSharedSession(shareToken) {
  const row = getSessionByShareToken(shareToken);
  if (!row) return { ok: false, status: 404, error: 'Shared session not found' };
  return { ok: true, session: sanitizeSession(row) };
}

function saveSession({ uid, passphrase, shareToken, state }) {
  const serialized = JSON.stringify(state);

  if (shareToken) {
    const row = getSessionByShareToken(shareToken);
    if (!row) return { ok: false, status: 404, error: 'Shared session not found' };
    db.prepare(
      `UPDATE sessions
       SET data = ?, updated_at = CURRENT_TIMESTAMP
       WHERE share_token = ?`
    ).run(serialized, shareToken);
    return { ok: true, session: sanitizeSession(getSessionByShareToken(shareToken)) };
  }

  if (!uid || !passphrase) {
    return { ok: false, status: 400, error: 'Missing owner credentials' };
  }

  const ownerResult = loadOwnerSession(uid, passphrase);
  if (!ownerResult.ok) return ownerResult;

  db.prepare(
    `UPDATE sessions
     SET data = ?, updated_at = CURRENT_TIMESTAMP
     WHERE uid = ?`
  ).run(serialized, uid);

  return { ok: true, session: sanitizeSession(getSessionByUid(uid)) };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: BASE_PATH + '/socket.io',
  cors: { origin: '*' },
});

app.use(express.json({ limit: '3mb' }));

app.get('/', (req, res) => res.sendFile(APP_FILE));
app.get('/index.html', (req, res) => res.sendFile(APP_FILE));
app.get(BASE_PATH, (req, res) => res.sendFile(APP_FILE));
app.get(BASE_PATH + '/', (req, res) => res.sendFile(APP_FILE));

app.post(BASE_PATH + '/api/session/create', (req, res) => {
  const state = req.body?.state;
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing state' });
  }

  const session = createSession(state);
  return res.json({ ok: true, session });
});

app.get(BASE_PATH + '/api/session', (req, res) => {
  const uid = String(req.query.uid || '').trim();
  const passphrase = String(req.query.pass || '').trim();
  if (!uid || !passphrase) {
    return res.status(400).json({ ok: false, error: 'Missing uid or passphrase' });
  }

  const result = loadOwnerSession(uid, passphrase);
  if (!result.ok) return res.status(result.status || 400).json(result);
  return res.json(result);
});

app.get(BASE_PATH + '/api/share/:shareToken', (req, res) => {
  const shareToken = String(req.params.shareToken || '').trim();
  if (!shareToken) {
    return res.status(400).json({ ok: false, error: 'Missing share token' });
  }

  const result = loadSharedSession(shareToken);
  if (!result.ok) return res.status(result.status || 400).json(result);
  return res.json(result);
});

app.post(BASE_PATH + '/api/session/save', (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  const passphrase = String(req.body?.pass || '').trim();
  const shareToken = String(req.body?.shareToken || '').trim();
  const state = req.body?.state;
  const clientId = String(req.body?.clientId || '');

  if (!state || typeof state !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing state' });
  }

  const result = saveSession({ uid, passphrase, shareToken, state });
  if (!result.ok) return res.status(result.status || 400).json(result);

  io.to(result.session.uid).emit('state-updated', {
    uid: result.session.uid,
    shareToken: result.session.shareToken,
    state,
    from: clientId,
  });

  return res.json({ ok: true, session: result.session });
});

io.on('connection', (socket) => {
  socket.on('join-session', ({ uid }) => {
    const room = String(uid || '').trim();
    if (!room) return;
    socket.join(room);
    socket.data.sessionUid = room;
    console.log(`[ws] ${socket.id} joined ${room}`);
  });

  socket.on('disconnect', () => {
    console.log(`[ws] client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Trip Planner server running on http://127.0.0.1:${PORT}${BASE_PATH}`);
});
