const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const PORT = 3456;
const BASE_PATH = '/atlanta-trip';
const APP_FILE = path.join(__dirname, 'atlanta-trip-planner.html');

const db = new Database(path.join(__dirname, 'trip-planner.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  uid TEXT PRIMARY KEY,
  pass_salt TEXT,
  pass_hash TEXT,
  data TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

function hashPass(pass, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPass(pass, salt, hash) {
  if (!pass || !salt || !hash) return false;
  const attempt = crypto.scryptSync(String(pass), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(hash, 'hex'));
}

function getSession(uid) {
  return db.prepare('SELECT * FROM sessions WHERE uid = ?').get(uid) || null;
}

function createOrUpdateSession({ uid, pass, state }) {
  const existing = getSession(uid);
  const serialized = JSON.stringify(state ?? null);

  if (existing) {
    if (existing.pass_hash) {
      if (!verifyPass(pass, existing.pass_salt, existing.pass_hash)) {
        return { ok: false, status: 401, error: 'Wrong passphrase' };
      }
    } else if (pass) {
      const { salt, hash } = hashPass(pass);
      db.prepare(
        `UPDATE sessions
         SET pass_salt = ?, pass_hash = ?, data = ?, updated_at = CURRENT_TIMESTAMP
         WHERE uid = ?`
      ).run(salt, hash, serialized, uid);
      return { ok: true, created: false, locked: true };
    }

    db.prepare(
      `UPDATE sessions
       SET data = ?, updated_at = CURRENT_TIMESTAMP
       WHERE uid = ?`
    ).run(serialized, uid);
    return { ok: true, created: false, locked: Boolean(existing.pass_hash) };
  }

  let salt = null;
  let hash = null;
  let locked = false;
  if (pass) {
    const h = hashPass(pass);
    salt = h.salt;
    hash = h.hash;
    locked = true;
  }

  db.prepare(
    `INSERT INTO sessions (uid, pass_salt, pass_hash, data, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(uid, salt, hash, serialized);

  return { ok: true, created: true, locked };
}

function readSession(uid, pass) {
  const row = getSession(uid);
  if (!row) return { ok: true, session: null };

  const locked = Boolean(row.pass_hash);
  if (locked && !verifyPass(pass, row.pass_salt, row.pass_hash)) {
    return { ok: false, status: 401, error: 'Wrong passphrase' };
  }

  return {
    ok: true,
    session: {
      uid: row.uid,
      hasPass: locked,
      state: row.data ? JSON.parse(row.data) : null,
      updatedAt: row.updated_at,
    },
  };
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

app.get(BASE_PATH + '/api/session', (req, res) => {
  const uid = String(req.query.uid || '').trim();
  const pass = String(req.query.pass || '');
  if (!uid) return res.status(400).json({ ok: false, error: 'Missing uid' });

  const result = readSession(uid, pass);
  if (!result.ok) return res.status(result.status || 400).json(result);
  return res.json(result);
});

app.post(BASE_PATH + '/api/session', (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  const pass = String(req.body?.pass || '');
  const state = req.body?.state;
  const clientId = String(req.body?.clientId || '');

  if (!uid) return res.status(400).json({ ok: false, error: 'Missing uid' });
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ ok: false, error: 'Missing state' });
  }

  const result = createOrUpdateSession({ uid, pass, state });
  if (!result.ok) return res.status(result.status || 400).json(result);

  io.to(uid).emit('state-updated', { uid, state, from: clientId });
  return res.json({ ok: true, uid, locked: result.locked });
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
