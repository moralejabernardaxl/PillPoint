const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware');
const router = express.Router();

router.use(requireAuth, requireRole('pharmacy_staff'));

function myPharmacyId(req) {
  return req.session.user.pharmacy_id;
}

// GET /api/pharmacy/dashboard
router.get('/dashboard', (req, res) => {
  const pid = myPharmacyId(req);
  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pid);
  const lowStock = db.prepare(`
    SELECT COUNT(*) AS count FROM inventory WHERE pharmacy_id = ? AND stock_quantity > 0 AND stock_quantity <= low_stock_threshold
  `).get(pid);
  const outStock = db.prepare(`SELECT COUNT(*) AS count FROM inventory WHERE pharmacy_id = ? AND stock_quantity = 0`).get(pid);
  const pendingReservations = db.prepare(`
    SELECT COUNT(*) AS count FROM reservations r JOIN inventory i ON i.id = r.inventory_id
    WHERE i.pharmacy_id = ? AND r.status = 'pending'
  `).get(pid);
  const confirmedReservations = db.prepare(`
    SELECT COUNT(*) AS count FROM reservations r JOIN inventory i ON i.id = r.inventory_id
    WHERE i.pharmacy_id = ? AND r.status = 'confirmed'
  `).get(pid);
  const completedPickups = db.prepare(`
    SELECT COUNT(*) AS count FROM reservations r JOIN inventory i ON i.id = r.inventory_id
    WHERE i.pharmacy_id = ? AND r.status = 'completed'
  `).get(pid);
  const totalItems = db.prepare('SELECT COUNT(*) AS count FROM inventory WHERE pharmacy_id = ?').get(pid);
  const estimatedInventoryValue = db.prepare(`
    SELECT COALESCE(SUM(price * stock_quantity), 0) AS total FROM inventory WHERE pharmacy_id = ?
  `).get(pid);
  const unreadNotifications = db.prepare(`
    SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0
  `).get(req.session.user.id);
  const deployedItems = db.prepare('SELECT COUNT(*) AS count FROM inventory WHERE pharmacy_id = ? AND deployed = 1').get(pid);
  const deployedFolders = db.prepare(`SELECT COUNT(*) AS count FROM folders WHERE pharmacy_id = ? AND status = 'deployed'`).get(pid);
  const totalFolders = db.prepare('SELECT COUNT(*) AS count FROM folders WHERE pharmacy_id = ?').get(pid);
  const deployedThisMonth = db.prepare(`
    SELECT COUNT(*) AS count FROM folder_deploy_log
    WHERE pharmacy_id = ? AND action = 'deployed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get(pid);

  // Inventory-by-category breakdown, for the 3D inventory pie chart.
  const inventoryByCategory = db.prepare(`
    SELECT COALESCE(m.category, 'Uncategorized') AS category, COUNT(*) AS count
    FROM inventory i JOIN medicines m ON m.id = i.medicine_id
    WHERE i.pharmacy_id = ?
    GROUP BY category ORDER BY count DESC
  `).all(pid);

  // Reservation activity by weekday (Mon → Sun) over the last 8 weeks.
  const weekdayRows = db.prepare(`
    SELECT r.reserved_at FROM reservations r JOIN inventory i ON i.id = r.inventory_id
    WHERE i.pharmacy_id = ? AND r.reserved_at >= datetime('now', '-56 days')
  `).all(pid);
  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  weekdayRows.forEach(r => {
    const jsDay = new Date(r.reserved_at).getDay(); // 0=Sun..6=Sat
    const idx = jsDay === 0 ? 6 : jsDay - 1; // shift so 0=Mon..6=Sun
    weekdayCounts[idx]++;
  });

  res.json({
    pharmacy,
    stats: {
      lowStock: lowStock.count,
      outOfStock: outStock.count,
      pendingReservations: pendingReservations.count,
      confirmedReservations: confirmedReservations.count,
      completedPickups: completedPickups.count,
      totalItems: totalItems.count,
      deployedItems: deployedItems.count,
      deployedFolders: deployedFolders.count,
      totalFolders: totalFolders.count,
      deployedThisMonth: deployedThisMonth.count,
      estimatedInventoryValue: +estimatedInventoryValue.total.toFixed(2),
      unreadNotifications: unreadNotifications.count,
    },
    inventoryByCategory,
    reservationStats: { labels: weekdayLabels, counts: weekdayCounts },
  });
});

// ---- Folders ----

// GET /api/pharmacy/folders — each folder with its product count & value
router.get('/folders', (req, res) => {
  const pid = myPharmacyId(req);
  const folders = db.prepare(`
    SELECT f.*, COUNT(i.id) AS product_count, COALESCE(SUM(i.price * i.stock_quantity),0) AS estimated_value
    FROM folders f LEFT JOIN inventory i ON i.folder_id = f.id
    WHERE f.pharmacy_id = ? GROUP BY f.id ORDER BY f.created_at DESC
  `).all(pid);
  const unassigned = db.prepare(`
    SELECT COUNT(*) AS count FROM inventory WHERE pharmacy_id = ? AND folder_id IS NULL
  `).get(pid);
  res.json({ folders, unassignedCount: unassigned.count });
});

// POST /api/pharmacy/folders  { name }
router.post('/folders', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(422).json({ error: 'Folder name is required.' });
  const info = db.prepare(`INSERT INTO folders (pharmacy_id, name, status) VALUES (?, ?, 'draft')`).run(myPharmacyId(req), name);
  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/pharmacy/folders/:id  { name }
router.put('/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  if (folder.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your folder.' });
  const name = (req.body.name || '').trim();
  if (!name) return res.status(422).json({ error: 'Folder name is required.' });
  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folder.id);
  res.json({ ok: true });
});

// DELETE /api/pharmacy/folders/:id — items inside are unassigned (not deleted) and undeployed
router.delete('/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  if (folder.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your folder.' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE inventory SET folder_id = NULL, deployed = 0 WHERE folder_id = ?').run(folder.id);
    db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
  });
  tx();
  res.json({ ok: true });
});

// POST /api/pharmacy/folders/:id/ready — mark draft folder as ready to deploy
router.post('/folders/:id/ready', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  if (folder.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your folder.' });
  if (folder.status !== 'draft') return res.status(422).json({ error: 'Only draft folders can be marked ready.' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM inventory WHERE folder_id = ?').get(folder.id).c;
  if (!count) return res.status(422).json({ error: 'Add at least one product to this folder first.' });
  db.prepare(`UPDATE folders SET status = 'ready' WHERE id = ?`).run(folder.id);
  res.json({ ok: true });
});

// POST /api/pharmacy/folders/:id/deploy — deploys every product inside the folder at once
router.post('/folders/:id/deploy', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  if (folder.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your folder.' });
  if (folder.status === 'deployed') return res.status(422).json({ error: 'This folder is already deployed.' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM inventory WHERE folder_id = ?').get(folder.id).c;
  if (!count) return res.status(422).json({ error: 'Add at least one product to this folder before deploying.' });

  const tx = db.transaction(() => {
    db.prepare(`UPDATE folders SET status = 'deployed', deployed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(folder.id);
    db.prepare(`UPDATE inventory SET deployed = 1, deployed_at = CURRENT_TIMESTAMP WHERE folder_id = ?`).run(folder.id);
    db.prepare(`
      INSERT INTO folder_deploy_log (pharmacy_id, folder_id, folder_name, product_count, action) VALUES (?,?,?,?,'deployed')
    `).run(folder.pharmacy_id, folder.id, folder.name, count);
  });
  tx();
  res.json({ ok: true, product_count: count });
});

// POST /api/pharmacy/folders/:id/undeploy — pulls every product in the folder back out of customer view
router.post('/folders/:id/undeploy', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  if (folder.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your folder.' });
  if (folder.status !== 'deployed') return res.status(422).json({ error: 'This folder is not currently deployed.' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM inventory WHERE folder_id = ?').get(folder.id).c;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE folders SET status = 'ready' WHERE id = ?`).run(folder.id);
    db.prepare(`UPDATE inventory SET deployed = 0 WHERE folder_id = ?`).run(folder.id);
    db.prepare(`
      INSERT INTO folder_deploy_log (pharmacy_id, folder_id, folder_name, product_count, action) VALUES (?,?,?,?,'undeployed')
    `).run(folder.pharmacy_id, folder.id, folder.name, count);
  });
  tx();
  res.json({ ok: true });
});

// POST /api/pharmacy/folders/:id/archive — retires a folder (undeploys it and marks archived)
router.post('/folders/:id/archive', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  if (folder.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your folder.' });
  const wasDeployed = folder.status === 'deployed';
  const count = db.prepare('SELECT COUNT(*) AS c FROM inventory WHERE folder_id = ?').get(folder.id).c;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE folders SET status = 'archived' WHERE id = ?`).run(folder.id);
    db.prepare(`UPDATE inventory SET deployed = 0 WHERE folder_id = ?`).run(folder.id);
    if (wasDeployed) {
      db.prepare(`
        INSERT INTO folder_deploy_log (pharmacy_id, folder_id, folder_name, product_count, action) VALUES (?,?,?,?,'undeployed')
      `).run(folder.pharmacy_id, folder.id, folder.name, count);
    }
  });
  tx();
  res.json({ ok: true });
});

// GET /api/pharmacy/deploy-log?month=YYYY-MM&folder_id=&q= — folder-level deployment history
router.get('/deploy-log', (req, res) => {
  const pid = myPharmacyId(req);
  const { month, folder_id, q } = req.query;
  const clauses = ['pharmacy_id = ?'];
  const params = [pid];
  if (month) { clauses.push(`strftime('%Y-%m', created_at) = ?`); params.push(month); }
  if (folder_id) { clauses.push('folder_id = ?'); params.push(folder_id); }
  if (q) { clauses.push('folder_name LIKE ?'); params.push(`%${q}%`); }

  const history = db.prepare(`
    SELECT * FROM folder_deploy_log WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 50
  `).all(...params);

  // For each deploy event, list which products were in that folder (current contents —
  // a simple, honest approximation since individual items aren't versioned).
  const withProducts = history.map(h => {
    const products = db.prepare(`
      SELECT m.name, i.brand FROM inventory i JOIN medicines m ON m.id = i.medicine_id WHERE i.folder_id = ?
    `).all(h.folder_id);
    return { ...h, products };
  });

  const deployedValue = db.prepare(`
    SELECT COALESCE(SUM(price * stock_quantity), 0) AS total, COUNT(*) AS count
    FROM inventory WHERE pharmacy_id = ? AND deployed = 1
  `).get(pid);

  res.json({
    history: withProducts,
    deployedStats: { estimatedValue: +deployedValue.total.toFixed(2), deployedCount: deployedValue.count },
  });
});

// ---- Inventory ----

// GET /api/pharmacy/inventory
router.get('/inventory', (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, m.name AS medicine_name, m.category, f.name AS folder_name, f.status AS folder_status
    FROM inventory i
    JOIN medicines m ON m.id = i.medicine_id
    LEFT JOIN folders f ON f.id = i.folder_id
    WHERE i.pharmacy_id = ?
    ORDER BY m.name ASC
  `).all(myPharmacyId(req));
  const medicines = db.prepare('SELECT * FROM medicines ORDER BY name ASC').all();
  const folders = db.prepare(`SELECT id, name, status FROM folders WHERE pharmacy_id = ? ORDER BY name ASC`).all(myPharmacyId(req));
  res.json({ inventory: rows, medicines, folders });
});

// POST /api/pharmacy/inventory  { medicine_id, brand, price, stock_quantity, low_stock_threshold, folder_id }
router.post('/inventory', (req, res) => {
  const { medicine_id, brand, price, stock_quantity, low_stock_threshold, folder_id } = req.body;
  if (!medicine_id || price == null || stock_quantity == null) {
    return res.status(422).json({ error: 'medicine_id, price and stock_quantity are required.' });
  }
  let resolvedFolderId = null;
  if (folder_id) {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folder_id);
    if (!folder || folder.pharmacy_id !== myPharmacyId(req)) {
      return res.status(422).json({ error: 'Invalid folder.' });
    }
    resolvedFolderId = folder.id;
  }
  try {
    const info = db.prepare(`
      INSERT INTO inventory (pharmacy_id, medicine_id, folder_id, price, stock_quantity, low_stock_threshold, brand)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(myPharmacyId(req), medicine_id, resolvedFolderId, price, stock_quantity, low_stock_threshold || 10, (brand || '').trim() || null);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(422).json({ error: 'This medicine is already in your inventory. Edit it instead.' });
    }
    res.status(500).json({ error: 'Could not add inventory item.' });
  }
});

// PUT /api/pharmacy/inventory/:id
router.put('/inventory/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your pharmacy inventory.' });

  const { price, stock_quantity, low_stock_threshold, brand } = req.body;
  db.prepare(`
    UPDATE inventory SET price = ?, stock_quantity = ?, low_stock_threshold = ?, brand = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    price != null ? price : item.price,
    stock_quantity != null ? stock_quantity : item.stock_quantity,
    low_stock_threshold != null ? low_stock_threshold : item.low_stock_threshold,
    brand !== undefined ? ((brand || '').trim() || null) : item.brand,
    item.id
  );
  res.json({ ok: true });
});

// PUT /api/pharmacy/inventory/:id/move  { folder_id }  — move a product into a folder, or null to unassign.
// Moving a deployed item out of its deployed folder automatically un-publishes it, since
// deployment status belongs to the folder, not the individual item.
router.put('/inventory/:id/move', (req, res) => {
  const item = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your pharmacy inventory.' });

  let targetFolder = null;
  if (req.body.folder_id) {
    targetFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.body.folder_id);
    if (!targetFolder || targetFolder.pharmacy_id !== myPharmacyId(req)) {
      return res.status(422).json({ error: 'Invalid folder.' });
    }
  }
  const deployed = targetFolder && targetFolder.status === 'deployed' ? 1 : 0;
  db.prepare(`
    UPDATE inventory SET folder_id = ?, deployed = ?, deployed_at = ? WHERE id = ?
  `).run(targetFolder ? targetFolder.id : null, deployed, deployed ? new Date().toISOString() : null, item.id);
  res.json({ ok: true });
});

// DELETE /api/pharmacy/inventory/:id
router.delete('/inventory/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM inventory WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.pharmacy_id !== myPharmacyId(req)) return res.status(403).json({ error: 'Not your pharmacy inventory.' });
  db.prepare('DELETE FROM inventory WHERE id = ?').run(item.id);
  res.json({ ok: true });
});

// GET /api/pharmacy/alerts — low stock / out of stock items
router.get('/alerts', (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, m.name AS medicine_name
    FROM inventory i JOIN medicines m ON m.id = i.medicine_id
    WHERE i.pharmacy_id = ? AND i.stock_quantity <= i.low_stock_threshold
    ORDER BY i.stock_quantity ASC
  `).all(myPharmacyId(req));
  res.json({ alerts: rows });
});

// GET /api/pharmacy/analytics
router.get('/analytics', (req, res) => {
  const pid = myPharmacyId(req);
  const byStatus = db.prepare(`
    SELECT r.status, COUNT(*) AS count FROM reservations r
    JOIN inventory i ON i.id = r.inventory_id WHERE i.pharmacy_id = ? GROUP BY r.status
  `).all(pid);
  const topMedicines = db.prepare(`
    SELECT m.name, SUM(r.quantity) AS total_reserved
    FROM reservations r
    JOIN inventory i ON i.id = r.inventory_id
    JOIN medicines m ON m.id = i.medicine_id
    WHERE i.pharmacy_id = ? AND r.status IN ('confirmed','completed')
    GROUP BY m.name ORDER BY total_reserved DESC LIMIT 5
  `).all(pid);

  const inventoryByCategory = db.prepare(`
    SELECT COALESCE(m.category, 'Uncategorized') AS category, COUNT(*) AS count, COALESCE(SUM(i.price * i.stock_quantity),0) AS value
    FROM inventory i JOIN medicines m ON m.id = i.medicine_id
    WHERE i.pharmacy_id = ? GROUP BY category ORDER BY count DESC
  `).all(pid);

  const deployedVsNot = db.prepare(`
    SELECT deployed, COUNT(*) AS count FROM inventory WHERE pharmacy_id = ? GROUP BY deployed
  `).all(pid);

  const weekdayRows = db.prepare(`
    SELECT r.reserved_at FROM reservations r JOIN inventory i ON i.id = r.inventory_id
    WHERE i.pharmacy_id = ? AND r.reserved_at >= datetime('now', '-56 days')
  `).all(pid);
  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  weekdayRows.forEach(r => {
    const jsDay = new Date(r.reserved_at).getDay();
    const idx = jsDay === 0 ? 6 : jsDay - 1;
    weekdayCounts[idx]++;
  });

  // Revenue trend (completed reservations) over the last 6 months.
  const monthlyRows = db.prepare(`
    SELECT strftime('%Y-%m', r.reserved_at) AS ym, SUM(r.quantity * i.price) AS revenue
    FROM reservations r JOIN inventory i ON i.id = r.inventory_id
    WHERE i.pharmacy_id = ? AND r.status = 'completed' AND r.reserved_at >= datetime('now', '-6 months')
    GROUP BY ym ORDER BY ym ASC
  `).all(pid);

  res.json({
    byStatus,
    topMedicines,
    inventoryByCategory,
    deployedVsNot,
    reservationStats: { labels: weekdayLabels, counts: weekdayCounts },
    monthlyRevenue: monthlyRows,
  });
});

// GET /api/pharmacy/profile — pharmacy record linked to this staff account's registration info
router.get('/profile', (req, res) => {
  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(myPharmacyId(req));
  res.json({ user: req.session.user, pharmacy });
});

// PUT /api/pharmacy/profile — only username (display name), phone number, and location are editable.
// Store photo/description/hours are also accepted here as part of "location & contact" upkeep.
router.put('/profile', (req, res) => {
  const pid = myPharmacyId(req);
  const { name, phone, address, latitude, longitude, store_image, description, hours } = req.body;

  if (store_image && !/^data:image\/(png|jpe?g|webp);base64,/.test(store_image)) {
    return res.status(422).json({ error: 'Store photo must be a PNG, JPG, or WEBP image.' });
  }

  const tx = db.transaction(() => {
    if (name != null && name.trim()) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.session.user.id);
      req.session.user.name = name.trim();
    }
    const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pid);
    const lat = latitude != null && latitude !== '' ? parseFloat(latitude) : pharmacy.latitude;
    const lng = longitude != null && longitude !== '' ? parseFloat(longitude) : pharmacy.longitude;
    db.prepare(`
      UPDATE pharmacies SET phone = ?, address = ?, latitude = ?, longitude = ?, store_image = ?, description = ?, hours = ? WHERE id = ?
    `).run(
      phone !== undefined ? ((phone || '').trim() || null) : pharmacy.phone,
      address !== undefined && address.trim() ? address.trim() : pharmacy.address,
      isFinite(lat) ? lat : pharmacy.latitude,
      isFinite(lng) ? lng : pharmacy.longitude,
      store_image !== undefined ? (store_image || null) : pharmacy.store_image,
      description !== undefined ? ((description || '').trim() || null) : pharmacy.description,
      hours !== undefined ? ((hours || '').trim() || null) : pharmacy.hours,
      pid
    );
  });
  tx();

  const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pid);
  res.json({ user: req.session.user, pharmacy });
});

// GET /api/pharmacy/reservations
router.get('/reservations', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, m.name AS medicine_name, u.name AS customer_name, u.email AS customer_email
    FROM reservations r
    JOIN inventory i ON i.id = r.inventory_id
    JOIN medicines m ON m.id = i.medicine_id
    JOIN users u ON u.id = r.customer_id
    WHERE i.pharmacy_id = ?
    ORDER BY r.reserved_at DESC
  `).all(myPharmacyId(req));
  res.json({ reservations: rows });
});

function transitionReservation(req, res, toStatus, allowedFrom, restoreStockIfCancel) {
  const reservation = db.prepare(`
    SELECT r.*, i.pharmacy_id FROM reservations r JOIN inventory i ON i.id = r.inventory_id WHERE r.id = ?
  `).get(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Reservation not found.' });
  if (reservation.pharmacy_id !== myPharmacyId(req)) {
    return res.status(403).json({ error: 'You can only manage your own pharmacy reservations.' });
  }
  if (!allowedFrom.includes(reservation.status)) {
    return res.status(422).json({ error: `Cannot move a ${reservation.status} reservation to ${toStatus}.` });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(toStatus, reservation.id);
    if (restoreStockIfCancel) {
      db.prepare('UPDATE inventory SET stock_quantity = stock_quantity + ? WHERE id = ?').run(reservation.quantity, reservation.inventory_id);
    }
    const medicine = db.prepare(`
      SELECT m.name FROM inventory i JOIN medicines m ON m.id = i.medicine_id WHERE i.id = ?
    `).get(reservation.inventory_id);
    const messages = {
      confirmed: `Your reservation for ${medicine.name} has been confirmed. Please pick it up before it expires.`,
      completed: `Your reservation for ${medicine.name} has been marked as picked up. Thank you!`,
      cancelled: `Your reservation for ${medicine.name} was cancelled by the pharmacy.`,
    };
    db.prepare(`INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)`).run(
      reservation.customer_id, `Reservation ${toStatus}`, messages[toStatus], 'reservation'
    );
  });
  tx();
  res.json({ ok: true });
}

router.post('/reservations/:id/confirm', (req, res) => transitionReservation(req, res, 'confirmed', ['pending'], false));
router.post('/reservations/:id/complete', (req, res) => transitionReservation(req, res, 'completed', ['confirmed'], false));
router.post('/reservations/:id/cancel', (req, res) => transitionReservation(req, res, 'cancelled', ['pending', 'confirmed'], true));

module.exports = router;
