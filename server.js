import express from 'express';
import Database from 'better-sqlite3';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    body TEXT NOT NULL,
    image TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS likes (
    comment_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (comment_id, user_id),
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_comments_product ON comments(product_id);
  CREATE INDEX IF NOT EXISTS idx_likes_comment ON likes(comment_id);
`);

const commentCols = db.prepare('PRAGMA table_info(comments)').all();
if (!commentCols.find((c) => c.name === 'parent_id')) {
  db.exec('ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE');
  db.exec('CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id)');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    expires_at INTEGER NOT NULL
  );
`);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'xiaofamous';
const ADMIN_SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD 未设置，使用默认密码 "xiaofamous"。上线前请设置环境变量。');
}

const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (productCount === 0) {
  const seed = db.prepare('INSERT INTO products (name, image, description) VALUES (?,?,?)');
  const items = [
    {
      name: '晨曦白瓷马克杯',
      image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800&q=80',
      description: '手工烧制的骨瓷马克杯，杯口薄如蝉翼，握感温润。容量 340ml，适合每一个清晨的第一口咖啡。',
    },
    {
      name: '手冲滴滤壶',
      image: 'https://images.unsplash.com/photo-1442550528053-c431ecb55509?w=800&q=80',
      description: '细口壶嘴精确控制水流，弧度经过数百次迭代。搭配温度计使用，把一次手冲变成一次仪式。',
    },
    {
      name: '棉麻围裙',
      image: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=80',
      description: '日式亚麻与纯棉混纺，洗多少次都只会更柔软。双口袋设计，适合下厨、烘焙或在工作室里走来走去。',
    },
    {
      name: '黄铜手冲秤',
      image: 'https://images.unsplash.com/photo-1511920170033-f8396924c348?w=800&q=80',
      description: '0.1g 精度，内置计时器。黄铜面板随时间生出独特包浆，越用越好看。',
    },
  ];
  const tx = db.transaction((rows) => rows.forEach((r) => seed.run(r.name, r.image, r.description)));
  tx(items);
}

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  let uid = req.headers.cookie?.match(/(?:^|;\s*)uid=([^;]+)/)?.[1];
  if (!uid) {
    uid = randomUUID();
    res.setHeader('Set-Cookie', `uid=${uid}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`);
  }
  req.userId = uid;
  next();
});

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 PNG / JPG / GIF / WEBP 图片'));
  },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.csv$/i.test(file.originalname) ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/csv';
    if (ok) cb(null, true);
    else cb(new Error('请上传 .csv 文件'));
  },
});

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false; continue;
      }
      field += c; continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}

app.get('/api/me', (req, res) => {
  res.json({ userId: req.userId });
});

function adminSessionToken(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)admin_session=([^;]+)/)?.[1] || null;
}

function isAdmin(req) {
  const token = adminSessionToken(req);
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM admin_sessions WHERE token = ?').get(token);
  if (!row) return false;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: '需要管理员登录' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const pw = (req.body && req.body.password) || '';
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: '密码错误' });
  const token = randomUUID();
  const expires = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL;
  db.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?,?)').run(token, expires);
  res.setHeader(
    'Set-Cookie',
    `admin_session=${token}; Path=/; Max-Age=${ADMIN_SESSION_TTL}; HttpOnly; SameSite=Lax`
  );
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const token = adminSessionToken(req);
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ authenticated: isAdmin(req) });
});

function removeUploadFile(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(url));
  if (file.startsWith(UPLOAD_DIR)) fs.promises.unlink(file).catch(() => {});
}

app.post('/api/admin/products', requireAdmin, upload.single('image'), (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 80);
  const description = (req.body.description || '').trim().slice(0, 2000);
  const imageUrl = (req.body.image_url || '').trim();
  const uploaded = req.file ? `/uploads/${req.file.filename}` : null;
  const image = uploaded || imageUrl;
  if (!name) return res.status(400).json({ error: '请填写产品名称' });
  if (!description) return res.status(400).json({ error: '请填写产品描述' });
  if (!image) return res.status(400).json({ error: '请上传图片或填写图片链接' });

  const info = db
    .prepare('INSERT INTO products (name, image, description) VALUES (?,?,?)')
    .run(name, image, description);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(product);
});

app.put('/api/admin/products/:id', requireAdmin, upload.single('image'), (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const name = (req.body.name || '').trim().slice(0, 80);
  const description = (req.body.description || '').trim().slice(0, 2000);
  const imageUrl = (req.body.image_url || '').trim();
  const uploaded = req.file ? `/uploads/${req.file.filename}` : null;
  const image = uploaded || imageUrl || existing.image;
  if (!name) return res.status(400).json({ error: '请填写产品名称' });
  if (!description) return res.status(400).json({ error: '请填写产品描述' });

  db.prepare('UPDATE products SET name = ?, description = ?, image = ? WHERE id = ?')
    .run(name, description, image, req.params.id);

  if (image !== existing.image) removeUploadFile(existing.image);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(product);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT image FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const commentImages = db
    .prepare('SELECT image FROM comments WHERE product_id = ? AND image IS NOT NULL')
    .all(req.params.id)
    .map((r) => r.image);

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);

  removeUploadFile(existing.image);
  for (const url of commentImages) removeUploadFile(url);

  res.json({ ok: true });
});

app.get('/api/admin/products/template.csv', requireAdmin, (_req, res) => {
  const csv =
    'name,description,image_url\n' +
    '"晨曦白瓷马克杯","手工烧制的骨瓷马克杯，杯口薄如蝉翼。若描述里包含逗号或换行，记得整个字段用双引号包起来","https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800&q=80"\n' +
    '"手冲滴滤壶","细口壶嘴精确控制水流。描述里要写双引号请写成两个""这样""","https://images.unsplash.com/photo-1442550528053-c431ecb55509?w=800&q=80"\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="products_template.csv"');
  res.send('\ufeff' + csv);
});

app.post('/api/admin/products/import', requireAdmin, csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传 CSV 文件' });

  let matrix;
  try {
    matrix = parseCSV(req.file.buffer.toString('utf-8'));
  } catch (e) {
    return res.status(400).json({ error: 'CSV 解析失败：' + e.message });
  }
  if (matrix.length < 2) return res.status(400).json({ error: 'CSV 为空或缺少数据行' });

  const headers = matrix[0].map((h) => h.trim().toLowerCase());
  const required = ['name', 'description', 'image_url'];
  const missing = required.filter((k) => !headers.includes(k));
  if (missing.length) return res.status(400).json({ error: `CSV 缺少列：${missing.join(', ')}` });

  const idx = {
    name: headers.indexOf('name'),
    description: headers.indexOf('description'),
    image_url: headers.indexOf('image_url'),
  };

  const findByName = db.prepare('SELECT id FROM products WHERE name = ?');
  const updateStmt = db.prepare('UPDATE products SET description = ?, image = ? WHERE id = ?');
  const insertStmt = db.prepare('INSERT INTO products (name, image, description) VALUES (?,?,?)');

  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors = [];

  const run = db.transaction(() => {
    for (let i = 1; i < matrix.length; i++) {
      const r = matrix[i];
      const name = (r[idx.name] || '').trim().slice(0, 80);
      const description = (r[idx.description] || '').trim().slice(0, 2000);
      const image = (r[idx.image_url] || '').trim();
      if (!name || !description || !image) {
        failed++;
        errors.push({ row: i + 1, error: '缺少 name/description/image_url' });
        continue;
      }
      try {
        const existing = findByName.get(name);
        if (existing) {
          updateStmt.run(description, image, existing.id);
          updated++;
        } else {
          insertStmt.run(name, image, description);
          created++;
        }
      } catch (e) {
        failed++;
        errors.push({ row: i + 1, error: e.message });
      }
    }
  });
  run();

  res.json({ created, updated, failed, total: matrix.length - 1, errors: errors.slice(0, 20) });
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/products', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.product_id = p.id) AS comment_count
       FROM products p ORDER BY p.id ASC`
    )
    .all();
  res.json(rows);
});

app.get('/api/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'not found' });

  const sort = req.query.sort === 'new' ? 'new' : 'hot';
  const rows = db
    .prepare(
      `SELECT c.id, c.product_id, c.parent_id, c.username, c.body, c.image, c.created_at,
              (c.user_id = ?) AS mine,
              (SELECT COUNT(*) FROM likes l WHERE l.comment_id = c.id) AS likes,
              EXISTS (SELECT 1 FROM likes l WHERE l.comment_id = c.id AND l.user_id = ?) AS liked_by_me
       FROM comments c
       WHERE c.product_id = ?`
    )
    .all(req.userId, req.userId, req.params.id);

  const parents = rows.filter((r) => r.parent_id == null);
  const replies = rows.filter((r) => r.parent_id != null);
  parents.sort((a, b) =>
    sort === 'new'
      ? b.created_at - a.created_at
      : b.likes - a.likes || b.created_at - a.created_at
  );
  replies.sort((a, b) => a.created_at - b.created_at);
  const byParent = new Map();
  for (const r of replies) {
    if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
    byParent.get(r.parent_id).push(r);
  }
  const tree = parents.map((p) => ({ ...p, replies: byParent.get(p.id) || [] }));

  res.json({ product, comments: tree, total: rows.length });
});

app.post('/api/products/:id/comments', upload.single('image'), (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'product not found' });

  const username = (req.body.username || '').trim().slice(0, 40);
  const body = (req.body.body || '').trim().slice(0, 1000);
  if (!username) return res.status(400).json({ error: '请填写昵称' });
  if (!body && !req.file) return res.status(400).json({ error: '评论不能为空' });

  let parentId = null;
  if (req.body.parent_id) {
    const pid = Number(req.body.parent_id);
    const parent = db
      .prepare('SELECT id, parent_id, product_id FROM comments WHERE id = ?')
      .get(pid);
    if (!parent || parent.product_id !== Number(req.params.id)) {
      return res.status(400).json({ error: '回复对象不存在' });
    }
    // only allow one level of nesting — reply to the root
    parentId = parent.parent_id ?? parent.id;
  }

  const image = req.file ? `/uploads/${req.file.filename}` : null;
  const info = db
    .prepare(
      'INSERT INTO comments (product_id, user_id, username, body, image, parent_id) VALUES (?,?,?,?,?,?)'
    )
    .run(req.params.id, req.userId, username, body, image, parentId);

  const comment = db
    .prepare(
      `SELECT c.id, c.product_id, c.parent_id, c.username, c.body, c.image, c.created_at,
              1 AS mine, 0 AS likes, 0 AS liked_by_me
       FROM comments c WHERE c.id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(comment);
});

app.delete('/api/comments/:id', (req, res) => {
  const comment = db
    .prepare('SELECT id, user_id, image FROM comments WHERE id = ?')
    .get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'comment not found' });
  if (comment.user_id !== req.userId) return res.status(403).json({ error: '不能删除别人的评论' });

  // collect any reply images too, so cascade delete doesn't orphan files
  const replyImages = db
    .prepare('SELECT image FROM comments WHERE parent_id = ? AND image IS NOT NULL')
    .all(req.params.id)
    .map((r) => r.image);
  const imagesToRemove = [comment.image, ...replyImages].filter(Boolean);

  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);

  for (const url of imagesToRemove) {
    const name = path.basename(url);
    const file = path.join(UPLOAD_DIR, name);
    if (file.startsWith(UPLOAD_DIR)) fs.promises.unlink(file).catch(() => {});
  }

  res.json({ ok: true });
});

app.post('/api/comments/:id/like', (req, res) => {
  const comment = db.prepare('SELECT id FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'comment not found' });

  const existing = db
    .prepare('SELECT 1 FROM likes WHERE comment_id = ? AND user_id = ?')
    .get(req.params.id, req.userId);

  if (existing) {
    db.prepare('DELETE FROM likes WHERE comment_id = ? AND user_id = ?').run(req.params.id, req.userId);
  } else {
    db.prepare('INSERT INTO likes (comment_id, user_id) VALUES (?,?)').run(req.params.id, req.userId);
  }

  const likes = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE comment_id = ?').get(req.params.id).c;
  res.json({ liked: !existing, likes });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || '请求失败' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`xiaofamoustalk → http://localhost:${PORT}`);
});
