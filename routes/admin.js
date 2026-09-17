const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware');
const router = express.Router();

router.use(requireAuth, requireRole('admin'));

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  const totals = {
    pharmacies: db.prepare('SELECT COUNT(*) AS c FROM pharmacies').get().c,
    verifiedPharmacies: db.prepare('SELECT COUNT(*) AS c FROM pharmacies WHERE verified = 1').get().c,
    customers: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'customer'").get().c,
    reservations: db.prepare('SELECT COUNT(*) AS c FROM reservations').get().c,
  };
  const shortageCount = db.prepare(`
    SELECT COUNT(*) AS c FROM (
      SELECT medicine_id FROM inventory GROUP BY medicine_id HAVING SUM(stock_quantity) = 0
    )
  `).get().c;

  const pendingReservations = db.prepare(`SELECT COUNT(*) AS c FROM reservations WHERE status = 'pending'`).get().c;
  const unverifiedPharmacies = totals.pharmacies - totals.verifiedPharmacies;
  const lowStockAlerts = db.prepare(`
    SELECT COUNT(*) AS c FROM inventory WHERE stock_quantity > 0 AND stock_quantity <= low_stock_threshold
  `).get().c;
  const totalInventoryValue = db.prepare(`SELECT COALESCE(SUM(price * stock_quantity),0) AS v FROM inventory`).get().v;
  const newCustomersThisWeek = db.prepare(`
    SELECT COUNT(*) AS c FROM users WHERE role = 'customer' AND created_at >= datetime('now','-7 days')
  `).get().c;

  const topPharmacies = db.prepare(`
    SELECT p.id, p.name, COUNT(r.id) AS reservation_count
    FROM pharmacies p
    LEFT JOIN inventory i ON i.pharmacy_id = p.id
    LEFT JOIN reservations r ON r.inventory_id = i.id
    GROUP BY p.id ORDER BY reservation_count DESC LIMIT 5
  `).all();

  const reservationsByStatus = db.prepare(`
    SELECT status, COUNT(*) AS count FROM reservations GROUP BY status
  `).all();

  res.json({
    totals,
    shortageCount,
    stats: {
      pendingReservations,
      unverifiedPharmacies,
      lowStockAlerts,
      totalInventoryValue: +totalInventoryValue.toFixed(2),
      newCustomersThisWeek,
    },
    topPharmacies,
    reservationsByStatus,
  });
});

// GET /api/admin/pharmacies?q=search+term
router.get('/pharmacies', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare(`
      SELECT * FROM pharmacies WHERE name LIKE ? OR address LIKE ? OR phone LIKE ? ORDER BY name ASC
    `).all(`%${q}%`, `%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM pharmacies ORDER BY name ASC').all();
  }
  // Attach a quick reservation count per pharmacy so admins have more context at a glance.
  const withCounts = rows.map(p => {
    const c = db.prepare(`
      SELECT COUNT(*) AS c FROM reservations r JOIN inventory i ON i.id = r.inventory_id WHERE i.pharmacy_id = ?
    `).get(p.id);
    return { ...p, reservation_count: c.c };
  });
  res.json({ pharmacies: withCounts });
});

// POST /api/admin/pharmacies/:id/notify  { title, message } — notifies every staff account at that pharmacy
router.post('/pharmacies/:id/notify', (req, res) => {
  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.params.id);
  if (!pharmacy) return res.status(404).json({ error: 'Pharmacy not found.' });
  const title = (req.body.title || '').trim();
  const message = (req.body.message || '').trim();
  if (!title || !message) {
    return res.status(422).json({ error: 'Title and message are required.' });
  }
  const staff = db.prepare(`SELECT id FROM users WHERE pharmacy_id = ? AND role = 'pharmacy_staff'`).all(pharmacy.id);
  if (!staff.length) {
    return res.status(422).json({ error: 'This pharmacy has no staff account to notify.' });
  }
  const insert = db.prepare(`INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,'admin')`);
  const tx = db.transaction(() => staff.forEach(s => insert.run(s.id, title, message)));
  tx();
  res.json({ ok: true, notified: staff.length });
});

router.post('/pharmacies/:id/verify', (req, res) => {
  const p = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Pharmacy not found.' });
  db.prepare('UPDATE pharmacies SET verified = 1 WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

router.post('/pharmacies/:id/unverify', (req, res) => {
  const p = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Pharmacy not found.' });
  db.prepare('UPDATE pharmacies SET verified = 0 WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

// GET /api/admin/shortages — medicines with zero total stock system-wide
router.get('/shortages', (req, res) => {
  const rows = db.prepare(`
    SELECT m.id AS medicine_id, m.name, m.category, COALESCE(SUM(i.stock_quantity), 0) AS total_stock,
           COUNT(i.id) AS pharmacies_carrying
    FROM medicines m
    LEFT JOIN inventory i ON i.medicine_id = m.id
    GROUP BY m.id
    HAVING total_stock = 0
    ORDER BY m.name ASC
  `).all();
  res.json({ shortages: rows });
});

// GET /api/admin/notifications
router.get('/notifications', (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  res.json({ notifications: rows });
});

module.exports = router;
