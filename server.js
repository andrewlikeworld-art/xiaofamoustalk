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

app.get('/api/me', (req, res) => {
  res.json({ userId: req.userId });
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
