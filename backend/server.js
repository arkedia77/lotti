const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3002;

// Middleware
app.use(cors());
app.use(express.json());

// DB setup
const dbPath = '/app/data/lotti.db';
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    author TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS post_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    filename TEXT,
    original_name TEXT,
    size INTEGER,
    FOREIGN KEY(post_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS milestones (
    name TEXT PRIMARY KEY,
    date TEXT,
    display_order INTEGER
  );

  CREATE TABLE IF NOT EXISTS boards (
    name TEXT PRIMARY KEY,
    content TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert initial boards if empty
const boardCount = db.prepare('SELECT COUNT(*) as cnt FROM boards').get();
if (boardCount.cnt === 0) {
  const insertBoard = db.prepare('INSERT OR IGNORE INTO boards (name) VALUES (?)');
  ['현황이슈', '향후예상이슈', '공유사항'].forEach(n => insertBoard.run(n));
}

// Insert initial milestones if empty
const milestoneCount = db.prepare('SELECT COUNT(*) as cnt FROM milestones').get();
if (milestoneCount.cnt === 0) {
  const insertMilestone = db.prepare('INSERT INTO milestones (name, date, display_order) VALUES (?, ?, ?)');
  const initialMilestones = [
    ['ABX3설립', null, 1],
    ['로티이전', null, 2],
    ['1차투자', null, 3],
    ['장치세팅', null, 4],
    ['2차투자', null, 5],
    ['파일럿가동', null, 6],
    ['샘플생산', null, 7],
  ];
  const insertMany = db.transaction((items) => {
    for (const item of items) insertMilestone.run(...item);
  });
  insertMany(initialMilestones);
}

// Multer setup
const storage = multer.diskStorage({
  destination: '/app/uploads/',
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Milestone APIs ───────────────────────────────────────────
app.get('/api/milestones', (req, res) => {
  const rows = db.prepare('SELECT * FROM milestones ORDER BY display_order').all();
  res.json(rows);
});

app.put('/api/milestones/:name', (req, res) => {
  const { name } = req.params;
  const { date } = req.body;
  const stmt = db.prepare('UPDATE milestones SET date = ? WHERE name = ?');
  const result = stmt.run(date || null, name);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Milestone not found' });
  }
  res.json({ ok: true });
});

// ─── Board APIs ───────────────────────────────────────────────
app.get('/api/boards', (req, res) => {
  const rows = db.prepare('SELECT * FROM boards ORDER BY name').all();
  // Return in fixed order
  const order = ['현황이슈', '향후예상이슈', '공유사항'];
  const sorted = order.map(n => rows.find(r => r.name === n)).filter(Boolean);
  res.json(sorted.length ? sorted : rows);
});

app.put('/api/boards/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const { content } = req.body;
  const stmt = db.prepare('UPDATE boards SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?');
  const result = stmt.run(content || '', name);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Board not found' });
  }
  res.json({ ok: true });
});

// ─── Post APIs ────────────────────────────────────────────────
app.get('/api/posts', (req, res) => {
  const { category } = req.query;
  let query = `
    SELECT p.*,
      (SELECT COUNT(*) FROM post_files WHERE post_id = p.id) as file_count
    FROM posts p
  `;
  const params = [];
  if (category && category !== '전체') {
    query += ' WHERE p.category = ?';
    params.push(category);
  }
  query += ' ORDER BY p.created_at DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

app.post('/api/posts', upload.array('files'), (req, res) => {
  const { title, content, author, category } = req.body;
  if (!title || !author || !category) {
    return res.status(400).json({ error: 'title, author, category required' });
  }

  const insertPost = db.prepare(
    'INSERT INTO posts (title, content, author, category) VALUES (?, ?, ?, ?)'
  );
  const insertFile = db.prepare(
    'INSERT INTO post_files (post_id, filename, original_name, size) VALUES (?, ?, ?, ?)'
  );

  const doInsert = db.transaction(() => {
    const postResult = insertPost.run(title, content || '', author, category);
    const postId = postResult.lastInsertRowid;
    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        insertFile.run(postId, f.filename, f.originalname, f.size);
      }
    }
    return postId;
  });

  const postId = doInsert();
  res.json({ ok: true, id: postId });
});

app.get('/api/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const files = db.prepare('SELECT * FROM post_files WHERE post_id = ?').all(req.params.id);
  res.json({ ...post, files });
});

app.get('/api/files/:id/download', (req, res) => {
  const file = db.prepare('SELECT * FROM post_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join('/app/uploads', file.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing' });
  res.download(filePath, file.original_name);
});

app.listen(PORT, () => {
  console.log(`Lotti backend running on port ${PORT}`);
});
