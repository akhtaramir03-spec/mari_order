// ============================================================
//  Mari Order — Cloudflare Worker  (D1 backend)
//  Sistem tempahan makanan layan diri
// ============================================================

let dbReady = false;

// ----- ensureDb: auto-setup tables + 15 sample items --------
async function ensureDb(db) {
  if (dbReady) return;

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active     INTEGER DEFAULT 1
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS menu_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      price       REAL    NOT NULL,
      emoji       TEXT    DEFAULT '🍽️',
      image_id    INTEGER,
      active      INTEGER DEFAULT 1,
      sort_order  INTEGER DEFAULT 0,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS images (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      data         BLOB,
      content_type TEXT DEFAULT 'image/jpeg'
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_type TEXT    NOT NULL,
      status     TEXT    DEFAULT 'pending',
      total      REAL    NOT NULL,
      created_at TEXT    DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS order_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id     INTEGER NOT NULL,
      menu_item_id INTEGER,
      item_name    TEXT    NOT NULL,
      price        REAL    NOT NULL,
      quantity     INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )`),
  ]);

  // Seed only once
  const row = await db.prepare('SELECT COUNT(*) AS c FROM categories').first();
  if (row.c === 0) {
    await db.batch([
      db.prepare('INSERT INTO categories (name,sort_order) VALUES (?,?)').bind('Nasi', 1),
      db.prepare('INSERT INTO categories (name,sort_order) VALUES (?,?)').bind('Mee', 2),
      db.prepare('INSERT INTO categories (name,sort_order) VALUES (?,?)').bind('Minuman', 3),
      db.prepare('INSERT INTO categories (name,sort_order) VALUES (?,?)').bind('Lauk', 4),
      db.prepare('INSERT INTO categories (name,sort_order) VALUES (?,?)').bind('Kuih', 5),
    ]);

    await db.batch([
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(1,'Nasi Lemak',5.00,'🍚',1),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(1,'Nasi Goreng',6.00,'🍳',2),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(1,'Nasi Ayam',7.00,'🍗',3),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(2,'Mee Goreng',5.50,'🍝',1),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(2,'Mee Sup',5.00,'🍜',2),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(2,'Laksa',6.50,'🥘',3),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(3,'Teh Tarik',2.50,'🍵',1),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(3,'Kopi O',2.00,'☕',2),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(3,'Milo Ais',3.50,'🥤',3),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(4,'Ayam Goreng',4.00,'🍗',1),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(4,'Rendang Daging',5.50,'🥩',2),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(4,'Telur Dadar',2.00,'🥚',3),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(5,'Kuih Lapis',1.50,'🍰',1),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(5,'Onde-Onde',1.00,'🟢',2),
      db.prepare('INSERT INTO menu_items (category_id,name,price,emoji,sort_order) VALUES (?,?,?,?,?)').bind(5,'Karipap',1.50,'🥟',3),
    ]);

    await db.batch([
      db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').bind('store_name','Mari Order'),
      db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').bind('banner','Selamat Datang! Sila buat pesanan anda.'),
      db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').bind('store_open','1'),
    ]);
  }

  dbReady = true;
}

// ----- helpers -----------------------------------------------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function checkAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD belum diset' }, 503);
  const h = request.headers.get('Authorization');
  if (!h || h !== `Bearer ${env.ADMIN_PASSWORD}`) return json({ error: 'Tidak dibenarkan' }, 401);
  return null;
}

// =============================================================
//  FETCH handler
// =============================================================
export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (!path.startsWith('/api/')) return new Response('Not Found', { status: 404 });

    const db = env.DB;
    await ensureDb(db);

    try {
      // ===================== PUBLIC =========================

      // Settings
      if (path === '/api/settings' && method === 'GET') {
        const { results } = await db.prepare('SELECT key,value FROM settings').all();
        const o = {}; for (const r of results) o[r.key] = r.value;
        return json(o);
      }

      // Categories
      if (path === '/api/categories' && method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM categories ORDER BY sort_order,id').all();
        return json(results);
      }

      // Menu
      if (path === '/api/menu' && method === 'GET') {
        const { results } = await db.prepare(
          `SELECT m.*, c.name AS category_name FROM menu_items m
           JOIN categories c ON m.category_id = c.id ORDER BY m.sort_order, m.id`
        ).all();
        return json(results);
      }

      // Images
      const imgM = path.match(/^\/api\/images\/(\d+)$/);
      if (imgM && method === 'GET') {
        const row = await db.prepare('SELECT data,content_type FROM images WHERE id=?').bind(+imgM[1]).first();
        if (!row) return new Response('Not Found', { status: 404 });
        const bytes = Uint8Array.from(row.data || []);
        return new Response(bytes.buffer, {
          headers: { 'Content-Type': row.content_type || 'image/jpeg', 'Cache-Control': 'public,max-age=86400' },
        });
      }

      // Create order
      if (path === '/api/orders' && method === 'POST') {
        const open = await db.prepare("SELECT value FROM settings WHERE key='store_open'").first();
        if (!open || open.value !== '1') return json({ error: 'Kedai sedang tutup' }, 400);

        const body = await request.json();
        const { items, order_type } = body;
        if (!items?.length || !order_type) return json({ error: 'Data pesanan tidak lengkap' }, 400);

        let total = 0;
        const valid = [];
        for (const it of items) {
          const mi = await db.prepare('SELECT id,name,price FROM menu_items WHERE id=? AND active=1').bind(it.id).first();
          if (!mi) return json({ error: `Item #${it.id} tidak aktif / tidak wujud` }, 400);
          const qty = Math.max(1, parseInt(it.quantity) || 1);
          total += mi.price * qty;
          valid.push({ menu_item_id: mi.id, item_name: mi.name, price: mi.price, quantity: qty });
        }
        total = Math.round(total * 100) / 100;

        const r = await db.prepare("INSERT INTO orders (order_type,total,status) VALUES (?  ,?,'pending')").bind(order_type, total).run();
        const orderId = r.meta.last_row_id;

        await db.batch(valid.map(v =>
          db.prepare('INSERT INTO order_items (order_id,menu_item_id,item_name,price,quantity) VALUES (?,?,?,?,?)')
            .bind(orderId, v.menu_item_id, v.item_name, v.price, v.quantity)
        ));

        return json({ order_id: orderId, queue_number: orderId, total, status: 'pending' });
      }

      // Order status (public polling)
      const osM = path.match(/^\/api\/orders\/(\d+)\/status$/);
      if (osM && method === 'GET') {
        const o = await db.prepare('SELECT id,status,order_type,total FROM orders WHERE id=?').bind(+osM[1]).first();
        if (!o) return json({ error: 'Pesanan tidak dijumpai' }, 404);
        return json(o);
      }

      // ===================== ADMIN ==========================

      // Login
      if (path === '/api/admin/login' && method === 'POST') {
        if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD belum diset dalam environment' }, 503);
        const b = await request.json();
        if (b.password === env.ADMIN_PASSWORD) return json({ success: true, token: env.ADMIN_PASSWORD });
        return json({ error: 'Kata laluan salah' }, 401);
      }

      // Settings update
      if (path === '/api/settings' && method === 'PUT') {
        const e = checkAdmin(request, env); if (e) return e;
        const b = await request.json();
        await db.batch(Object.entries(b).map(([k, v]) =>
          db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind(k, String(v))
        ));
        return json({ success: true });
      }

      // Create category
      if (path === '/api/categories' && method === 'POST') {
        const e = checkAdmin(request, env); if (e) return e;
        const b = await request.json();
        const r = await db.prepare('INSERT INTO categories (name,sort_order,active) VALUES (?,?,?)').bind(b.name, b.sort_order ?? 0, b.active ?? 1).run();
        return json({ id: r.meta.last_row_id });
      }

      // Category by id
      const catM = path.match(/^\/api\/categories\/(\d+)$/);
      if (catM) {
        const id = +catM[1];
        if (method === 'PUT') {
          const e = checkAdmin(request, env); if (e) return e;
          const b = await request.json();
          await db.prepare('UPDATE categories SET name=?,sort_order=?,active=? WHERE id=?').bind(b.name, b.sort_order ?? 0, b.active ?? 1, id).run();
          return json({ success: true });
        }
        if (method === 'DELETE') {
          const e = checkAdmin(request, env); if (e) return e;
          const { c } = await db.prepare('SELECT COUNT(*) AS c FROM menu_items WHERE category_id=?').bind(id).first();
          if (c > 0) return json({ error: 'Tidak boleh padam kategori yang masih ada item menu' }, 409);
          await db.prepare('DELETE FROM categories WHERE id=?').bind(id).run();
          return json({ success: true });
        }
      }

      // Create menu item
      if (path === '/api/menu' && method === 'POST') {
        const e = checkAdmin(request, env); if (e) return e;
        const b = await request.json();
        const r = await db.prepare(
          'INSERT INTO menu_items (category_id,name,price,emoji,image_id,active,sort_order) VALUES (?,?,?,?,?,?,?)'
        ).bind(b.category_id, b.name, b.price, b.emoji || '🍽️', b.image_id ?? null, b.active ?? 1, b.sort_order ?? 0).run();
        return json({ id: r.meta.last_row_id });
      }

      // Menu item by id
      const miM = path.match(/^\/api\/menu\/(\d+)$/);
      if (miM) {
        const id = +miM[1];
        if (method === 'PUT') {
          const e = checkAdmin(request, env); if (e) return e;
          const b = await request.json();
          await db.prepare(
            'UPDATE menu_items SET category_id=?,name=?,price=?,emoji=?,image_id=?,active=?,sort_order=? WHERE id=?'
          ).bind(b.category_id, b.name, b.price, b.emoji || '🍽️', b.image_id ?? null, b.active ?? 1, b.sort_order ?? 0, id).run();
          return json({ success: true });
        }
        if (method === 'DELETE') {
          const e = checkAdmin(request, env); if (e) return e;
          await db.prepare('DELETE FROM menu_items WHERE id=?').bind(id).run();
          return json({ success: true });
        }
      }

      // Upload image
      if (path === '/api/images' && method === 'POST') {
        const e = checkAdmin(request, env); if (e) return e;
        const ct  = request.headers.get('Content-Type') || 'image/jpeg';
        const buf = await request.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const r = await db.prepare('INSERT INTO images (data,content_type) VALUES (?,?)').bind(bytes.buffer, ct).run();
        return json({ id: r.meta.last_row_id });
      }

      // List orders (admin)
      if (path === '/api/orders' && method === 'GET') {
        const e = checkAdmin(request, env); if (e) return e;
        const status = url.searchParams.get('status');
        const { results } = status
          ? await db.prepare('SELECT * FROM orders WHERE status=? ORDER BY id DESC LIMIT 100').bind(status).all()
          : await db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 100').all();
        const out = [];
        for (const o of results) {
          const it = await db.prepare('SELECT * FROM order_items WHERE order_id=?').bind(o.id).all();
          out.push({ ...o, items: it.results });
        }
        return json(out);
      }

      // Update order status
      const ouM = path.match(/^\/api\/orders\/(\d+)\/status$/);
      if (ouM && method === 'PUT') {
        const e = checkAdmin(request, env); if (e) return e;
        const b = await request.json();
        await db.prepare('UPDATE orders SET status=? WHERE id=?').bind(b.status, +ouM[1]).run();
        return json({ success: true });
      }

      return json({ error: 'Laluan API tidak dijumpai' }, 404);

    } catch (err) {
      console.error(err);
      return json({ error: err.message || 'Ralat pelayan' }, 500);
    }
  },
};
