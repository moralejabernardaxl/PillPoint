const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware');
const router = express.Router();

// Haversine distance in km
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.use(requireAuth, requireRole('customer'));

// GET /api/customer/dashboard
router.get('/dashboard', (req, res) => {
  const uid = req.session.user.id;
  const recentReservations = db.prepare(`
    SELECT r.id, r.quantity, r.status, r.reserved_at, m.name AS medicine_name, p.name AS pharmacy_name
    FROM reservations r
    JOIN inventory i ON i.id = r.inventory_id
    JOIN medicines m ON m.id = i.medicine_id
    JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE r.customer_id = ?
    ORDER BY r.reserved_at DESC LIMIT 5
  `).all(uid);

  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) AS count FROM reservations WHERE customer_id = ? GROUP BY status
  `).all(uid);

  const unreadNotifications = db.prepare(`
    SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0
  `).get(uid);

  // Real search-activity stats, derived from search_logs (populated every time
  // this customer runs a search on the Search Medicines page).
  const searchesMade = db.prepare(`SELECT COUNT(*) AS count FROM search_logs WHERE user_id = ?`).get(uid).count;

  const medicinesSearched = db.prepare(`
    SELECT COUNT(DISTINCT je.value) AS count
    FROM search_logs, json_each(search_logs.medicine_ids) je
    WHERE search_logs.user_id = ?
  `).get(uid).count;

  const pharmaciesViewed = db.prepare(`
    SELECT COUNT(DISTINCT je.value) AS count
    FROM search_logs, json_each(search_logs.pharmacy_ids) je
    WHERE search_logs.user_id = ?
  `).get(uid).count;

  // Top 5 most-searched medicines for this customer (one count per search event
  // that surfaced the medicine, not per pharmacy row) — powers the pie chart.
  const topSearchedMedicines = db.prepare(`
    SELECT m.name, COUNT(*) AS count
    FROM search_logs, json_each(search_logs.medicine_ids) je
    JOIN medicines m ON m.id = je.value
    WHERE search_logs.user_id = ?
    GROUP BY m.id
    ORDER BY count DESC, m.name ASC
    LIMIT 5
  `).all(uid);

  // Potential savings: for completed reservations, compare what was paid against
  // the average price of that same medicine across all pharmacies right now.
  const savingsRows = db.prepare(`
    SELECT r.quantity, i.price AS paid_price, i.medicine_id
    FROM reservations r
    JOIN inventory i ON i.id = r.inventory_id
    WHERE r.customer_id = ? AND r.status = 'completed'
  `).all(uid);
  let potentialSavings = 0;
  if (savingsRows.length) {
    const avgPriceStmt = db.prepare(`SELECT AVG(price) AS avg_price FROM inventory WHERE medicine_id = ?`);
    savingsRows.forEach(r => {
      const avg = avgPriceStmt.get(r.medicine_id).avg_price || r.paid_price;
      const diff = (avg - r.paid_price) * r.quantity;
      if (diff > 0) potentialSavings += diff;
    });
  }

  res.json({
    user: req.session.user,
    recentReservations,
    statusCounts,
    unreadNotifications: unreadNotifications.count,
    searchActivity: {
      searchesMade,
      medicinesSearched,
      pharmaciesViewed,
      potentialSavings: +potentialSavings.toFixed(2),
      topSearchedMedicines,
    },
  });
});

// GET /api/customer/medicines/search?q=&category=
router.get('/medicines/search', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const category = (req.query.category || '').trim();

  let sql = `
    SELECT i.id AS inventory_id, i.price, i.stock_quantity, i.low_stock_threshold, i.brand,
           m.id AS medicine_id, m.name AS medicine_name, m.category,
           p.id AS pharmacy_id, p.name AS pharmacy_name, p.address, p.latitude, p.longitude, p.verified, p.store_image
    FROM inventory i
    JOIN medicines m ON m.id = i.medicine_id
    JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE m.name LIKE ? AND i.deployed = 1
  `;
  const params = [q];
  if (category) {
    sql += ' AND m.category = ?';
    params.push(category);
  }
  sql += ' ORDER BY m.name ASC, i.price ASC';
  const rows = db.prepare(sql).all(...params);

  // shortage flag: true if a searched medicine has zero pharmacies with stock > 0
  const grouped = {};
  rows.forEach(r => {
    grouped[r.medicine_id] = grouped[r.medicine_id] || [];
    grouped[r.medicine_id].push(r);
  });
  const shortageMedicineIds = Object.keys(grouped).filter(mid =>
    grouped[mid].every(r => r.stock_quantity === 0)
  ).map(Number);

  const categories = db.prepare('SELECT DISTINCT category FROM medicines WHERE category IS NOT NULL').all().map(c => c.category);

  // Log this search as real activity — only when it actually looked for something,
  // so an empty initial page load doesn't get counted.
  const rawQuery = (req.query.q || '').trim();
  if (rawQuery || category) {
    const medicineIds = [...new Set(rows.map(r => r.medicine_id))];
    const pharmacyIds = [...new Set(rows.map(r => r.pharmacy_id))];
    db.prepare(`
      INSERT INTO search_logs (user_id, query, category, medicine_ids, pharmacy_ids, result_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.session.user.id, rawQuery || null, category || null,
      JSON.stringify(medicineIds), JSON.stringify(pharmacyIds), rows.length
    );
  }

  res.json({ results: rows, shortageMedicineIds, categories });
});

// GET /api/customer/medicines/:id/compare  (price comparison across pharmacies)
router.get('/medicines/:id/compare', (req, res) => {
  const medicine = db.prepare('SELECT * FROM medicines WHERE id = ?').get(req.params.id);
  if (!medicine) return res.status(404).json({ error: 'Medicine not found' });

  const rows = db.prepare(`
    SELECT i.id AS inventory_id, i.price, i.stock_quantity,
           p.id AS pharmacy_id, p.name AS pharmacy_name, p.address, p.latitude, p.longitude, p.verified, p.store_image
    FROM inventory i
    JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE i.medicine_id = ? AND i.deployed = 1
    ORDER BY i.price ASC
  `).all(req.params.id);

  res.json({ medicine, offers: rows });
});

// GET /api/customer/pharmacies/nearby?lat=&lng=
router.get('/pharmacies/nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const pharmacies = db.prepare('SELECT * FROM pharmacies').all();

  const withDistance = pharmacies.map(p => ({
    ...p,
    distance_km: (isFinite(lat) && isFinite(lng)) ? +distanceKm(lat, lng, p.latitude, p.longitude).toFixed(2) : null,
  }));

  if (isFinite(lat) && isFinite(lng)) {
    withDistance.sort((a, b) => a.distance_km - b.distance_km);
  }

  res.json({ pharmacies: withDistance, hasUserLocation: isFinite(lat) && isFinite(lng) });
});

// GET /api/customer/pharmacies/:id — full pharmacy profile + its currently deployed products.
// "Currently selling" always reflects live folder deployments, never draft/archived items.
router.get('/pharmacies/:id', (req, res) => {
  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.params.id);
  if (!pharmacy) return res.status(404).json({ error: 'Pharmacy not found.' });

  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const distance_km = (isFinite(lat) && isFinite(lng))
    ? +distanceKm(lat, lng, pharmacy.latitude, pharmacy.longitude).toFixed(2)
    : null;

  const products = db.prepare(`
    SELECT i.id AS inventory_id, i.price, i.stock_quantity, i.brand,
           m.id AS medicine_id, m.name AS medicine_name, m.category
    FROM inventory i JOIN medicines m ON m.id = i.medicine_id
    WHERE i.pharmacy_id = ? AND i.deployed = 1
    ORDER BY m.name ASC
  `).all(pharmacy.id);

  res.json({ pharmacy: { ...pharmacy, distance_km }, products });
});

// GET /api/customer/reservations
router.get('/reservations', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, m.name AS medicine_name, p.name AS pharmacy_name, i.price
    FROM reservations r
    JOIN inventory i ON i.id = r.inventory_id
    JOIN medicines m ON m.id = i.medicine_id
    JOIN pharmacies p ON p.id = i.pharmacy_id
    WHERE r.customer_id = ?
    ORDER BY r.reserved_at DESC
  `).all(req.session.user.id);
  res.json({ reservations: rows });
});

// POST /api/customer/reservations  { inventory_id, quantity }
router.post('/reservations', (req, res) => {
  const { inventory_id, quantity } = req.body;
  const qty = parseInt(quantity, 10);
  if (!inventory_id || !qty || qty < 1) {
    return res.status(422).json({ error: 'inventory_id and a valid quantity are required.' });
  }

  const inv = db.prepare('SELECT * FROM inventory WHERE id = ?').get(inventory_id);
  if (!inv) return res.status(404).json({ error: 'Inventory item not found.' });
  if (!inv.deployed) return res.status(422).json({ error: 'This item is not currently available for reservation.' });
  if (inv.stock_quantity < qty) {
    return res.status(422).json({ error: 'Not enough stock available.' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE inventory SET stock_quantity = stock_quantity - ? WHERE id = ?').run(qty, inv.id);
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString(); // 2 days
    const info = db.prepare(`
      INSERT INTO reservations (customer_id, inventory_id, quantity, status, expires_at)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(req.session.user.id, inv.id, qty, expires);

    const medicine = db.prepare('SELECT name FROM medicines WHERE id = ?').get(inv.medicine_id);
    db.prepare(`INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)`).run(
      req.session.user.id, 'Reservation placed',
      `Your reservation for ${medicine.name} (x${qty}) is pending pharmacy confirmation.`, 'reservation'
    );
    return info.lastInsertRowid;
  });

  const id = tx();
  res.status(201).json({ reservation_id: id });
});

// POST /api/customer/reservations/:id/cancel
router.post('/reservations/:id/cancel', (req, res) => {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Reservation not found.' });
  if (reservation.customer_id !== req.session.user.id) {
    return res.status(403).json({ error: 'You can only cancel your own reservations.' });
  }
  if (!['pending', 'confirmed'].includes(reservation.status)) {
    return res.status(422).json({ error: 'Only pending or confirmed reservations can be cancelled.' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run('cancelled', reservation.id);
    db.prepare('UPDATE inventory SET stock_quantity = stock_quantity + ? WHERE id = ?').run(reservation.quantity, reservation.inventory_id);
  });
  tx();

  res.json({ ok: true });
});

// GET /api/customer/notifications
router.get('/notifications', (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  res.json({ notifications: rows });
});

// POST /api/customer/notifications/:id/read
router.post('/notifications/:id/read', (req, res) => {
  const n = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!n || n.user_id !== req.session.user.id) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(n.id);
  res.json({ ok: true });
});

module.exports = router;
