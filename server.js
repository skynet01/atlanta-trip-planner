const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

const PORT = 3456;
const BASE_PATH = '/atlanta-trip';

// --- Database ---
const db = new Database(path.join(__dirname, 'trip-planner.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  data TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

function getState() {
  const row = db.prepare('SELECT data FROM state WHERE id = ?').get('main');
  return row ? JSON.parse(row.data) : null;
}

function setState(data) {
  const json = JSON.stringify(data);
  db.prepare(`INSERT INTO state (id, data, updated_at) VALUES ('main', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`).run(json);
}

// --- Express + Socket.IO ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: BASE_PATH + '/socket.io',
  cors: { origin: '*' }
});

app.use(express.json({ limit: '2mb' }));

// Serve static HTML
app.get(BASE_PATH, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get(BASE_PATH + '/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: get state
app.get(BASE_PATH + '/api/state', (req, res) => {
  const state = getState();
  res.json({ ok: true, state });
});

// API: save state
app.post(BASE_PATH + '/api/state', (req, res) => {
  const { state, clientId } = req.body;
  if (!state) return res.status(400).json({ ok: false, error: 'Missing state' });
  setState(state);
  // Broadcast to all OTHER clients
  io.emit('state-updated', { state, from: clientId });
  res.json({ ok: true });
});

// Socket.IO
io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[ws] client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Trip Planner server running on http://127.0.0.1:${PORT}${BASE_PATH}`);
});
