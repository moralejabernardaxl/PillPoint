(async function () {
  const user = await guardPage(['pharmacy_staff'], 'Pharmacy Dashboard', 'Overview of your pharmacy');
  if (!user) return;
  const content = document.getElementById('page-content');
  content.innerHTML = `<div class="empty-state">Loading...</div>`;
  try {
    const data = await Api.get('/api/pharmacy/dashboard');
    content.innerHTML = `
      <div class="card mt-8" style="background:linear-gradient(135deg,var(--navy),#142234);color:#fff;border:none;">
        <h2 style="color:#fff;">${escapeHtml(data.pharmacy.name)}</h2>
        <p class="mt-8" style="color:#a6b2c4;">${escapeHtml(data.pharmacy.address)}</p>
        <div class="mt-8">
          ${data.pharmacy.verified ? '<span class="badge badge-verified">Verified</span>' : '<span class="badge badge-unverified">Pending verification</span>'}
        </div>
      </div>
      <div class="grid grid-4 mt-24">
        <div class="card stat-card"><div class="stat-icon">&#128137;</div><div class="stat-label">Total Items</div><div class="stat-value">${data.stats.totalItems}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#9888;</div><div class="stat-label">Low Stock</div><div class="stat-value">${data.stats.lowStock}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#10060;</div><div class="stat-label">Out of Stock</div><div class="stat-value">${data.stats.outOfStock}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#9203;</div><div class="stat-label">Pending Reservations</div><div class="stat-value">${data.stats.pendingReservations}</div></div>
      </div>
      <div class="grid grid-4 mt-24">
        <div class="card stat-card"><div class="stat-icon">&#9989;</div><div class="stat-label">Confirmed Reservation</div><div class="stat-value">${data.stats.confirmedReservations}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#128230;</div><div class="stat-label">Complete / Pick up</div><div class="stat-value">${data.stats.completedPickups}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#128176;</div><div class="stat-label">Estimated Inventory Value</div><div class="stat-value">${money(data.stats.estimatedInventoryValue)}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#128276;</div><div class="stat-label">Unread Notification</div><div class="stat-value">${data.stats.unreadNotifications}</div></div>
      </div>
      <div class="grid grid-4 mt-24">
        <div class="card stat-card"><div class="stat-icon">&#128193;</div><div class="stat-label">Deployed Folders</div><div class="stat-value">${data.stats.deployedFolders} / ${data.stats.totalFolders}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#128197;</div><div class="stat-label">Deployed This Month</div><div class="stat-value">${data.stats.deployedThisMonth}</div></div>
      </div>

      <div class="grid mt-24" style="grid-template-columns: 1fr 1.2fr; gap:18px;">
        <div class="card">
          <div class="card-title">Inventory Statistics</div>
          ${data.inventoryByCategory.length
            ? pieChart3D(data.inventoryByCategory.map(c => ({ label: c.category, value: c.count })))
            : `<div class="empty-state" style="padding:24px;"><p class="text-sm">Add inventory to see this breakdown.</p></div>`}
        </div>
        <div class="card">
          <div class="card-title">Reservation Statistics <span class="text-sm muted" style="font-weight:400;">(Mon–Sun, last 8 weeks)</span></div>
          ${weekdayBarChart(data.reservationStats.labels, data.reservationStats.counts)}
        </div>
      </div>

      <div class="flex gap-12 mt-24">
        <a href="/pharmacy/inventory.html" class="btn btn-primary">Manage Inventory</a>
        <a href="/pharmacy/reservations.html" class="btn btn-outline">View Reservations</a>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();
