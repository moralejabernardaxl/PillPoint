const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAuth } = require('../middleware');
const router = express.Router();

const EIGHT_HOURS = 1000 * 60 * 60 * 8;
const THIRTY_DAYS = 1000 * 60 * 60 * 24 * 30;

// POST /api/auth/register
// Self-registration is intentionally restricted to 'customer' and 'pharmacy_staff'.
// There is no code path here that can create an 'admin' account — admins are
// provisioned only via the seeded database account.
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  const role = req.body.role === 'pharmacy_staff' ? 'pharmacy_staff' : 'customer';

  if (!name || !email || !password) {
    return res.status(422).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(422).json({ error: 'Password must be at least 6 characters.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(422).json({ error: 'An account with that email already exists.' });
  }

  const hash = bcrypt.hashSync(password, 10);

  if (role === 'pharmacy_staff') {
    const { pharmacy_name, pharmacy_address, pharmacy_phone, latitude, longitude, store_image, description, hours } = req.body;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (!pharmacy_name || !pharmacy_address) {
      return res.status(422).json({ error: 'Pharmacy name and address are required.' });
    }
    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(422).json({ error: 'Please set your pharmacy location on the map.' });
    }
    if (store_image && !/^data:image\/(png|jpe?g|webp);base64,/.test(store_image)) {
      return res.status(422).json({ error: 'Store photo must be a PNG, JPG, or WEBP image.' });
    }

    const tx = db.transaction(() => {
      const pharmacyInfo = db.prepare(`
        INSERT INTO pharmacies (name, address, latitude, longitude, phone, verified, store_image, description, hours)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(pharmacy_name, pharmacy_address, lat, lng, pharmacy_phone || null, store_image || null, (description || '').trim() || null, (hours || '').trim() || null);

      const userInfo = db.prepare(`
        INSERT INTO users (name, email, password_hash, role, pharmacy_id) VALUES (?, ?, ?, 'pharmacy_staff', ?)
      `).run(name, email, hash, pharmacyInfo.lastInsertRowid);

      db.prepare(`INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)`).run(
        userInfo.lastInsertRowid, 'Welcome to PillPoint',
        `${pharmacy_name} has been registered and is pending admin verification. You can manage inventory in the meantime.`,
        'info'
      );

      return userInfo.lastInsertRowid;
    });

    const userId = tx();
    const user = db.prepare('SELECT id, name, email, role, pharmacy_id FROM users WHERE id = ?').get(userId);
    req.session.user = user;
    return res.json({ user });
  }

  const info = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, pharmacy_id) VALUES (?, ?, ?, 'customer', NULL)`
  ).run(name, email, hash);

  const user = db.prepare('SELECT id, name, email, role, pharmacy_id FROM users WHERE id = ?').get(info.lastInsertRowid);
  req.session.user = user;
  res.json({ user });
});

router.post('/login', (req, res) => {
  const { email, password, remember } = req.body;
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const user = { id: row.id, name: row.name, email: row.email, role: row.role, pharmacy_id: row.pharmacy_id };
  req.session.user = user;
  // "Remember me" extends the session cookie from the default 8 hours to 30 days.
  req.session.cookie.maxAge = remember ? THIRTY_DAYS : EIGHT_HOURS;
  res.json({ user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// PUT /api/auth/profile  { name }
// Any authenticated role can update their own display name.
router.put('/profile', requireAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(422).json({ error: 'Name cannot be empty.' });
  }
  if (name.length > 100) {
    return res.status(422).json({ error: 'Name is too long.' });
  }
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.session.user.id);
  req.session.user.name = name;
  res.json({ user: req.session.user });
});

module.exports = router;
