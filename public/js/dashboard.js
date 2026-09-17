(async function () {
  const user = await guardPage(['customer'], 'Dashboard', 'Welcome back');
  if (!user) return;

  const content = document.getElementById('page-content');
  content.innerHTML = `<div class="empty-state">Loading...</div>`;

  try {
    const data = await Api.get('/api/customer/dashboard');
    const counts = {};
    data.statusCounts.forEach(s => counts[s.status] = s.count);
    const sa = data.searchActivity;

    content.innerHTML = `
      <div class="card mt-8 card-hero" style="background:linear-gradient(135deg,var(--navy),#142234);color:#fff;border:none;">
        <h2 style="color:#fff;">Welcome back, ${escapeHtml(data.user.name)} 👋</h2>
        <p class="mt-8" style="color:#a6b2c4;">Search for medicine, compare prices, and manage your reservations.</p>
        <a href="/search.html" class="btn btn-primary mt-16" style="display:inline-flex;">Search Medicines</a>
      </div>

      <div class="grid grid-4 mt-24">
        <div class="card stat-card"><div class="stat-icon">&#9203;</div><div class="stat-label">Pending</div><div class="stat-value">${counts.pending || 0}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#9989;</div><div class="stat-label">Confirmed</div><div class="stat-value">${counts.confirmed || 0}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#128230;</div><div class="stat-label">Completed</div><div class="stat-value">${counts.completed || 0}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#128276;</div><div class="stat-label">Unread Notifications</div><div class="stat-value">${data.unreadNotifications}</div></div>
      </div>

      <div class="section-title">Your Search Activity</div>
      <div class="grid grid-4">
        <div class="card stat-card"><div class="stat-icon">&#128269;</div><div class="stat-label">Searches Made</div><div class="stat-value">${sa.searchesMade}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#128138;</div><div class="stat-label">Medicines Searched</div><div class="stat-value">${sa.medicinesSearched}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#127974;</div><div class="stat-label">Pharmacies Viewed</div><div class="stat-value">${sa.pharmaciesViewed}</div></div>
        <div class="card stat-card"><div class="stat-icon">&#128176;</div><div class="stat-label">Potential Savings</div><div class="stat-value">${money(sa.potentialSavings)}</div></div>
      </div>

      <div class="grid mt-24" style="grid-template-columns: 1fr 1.4fr; gap:18px;">
        <div class="card">
          <div class="card-title">Most Searched Medicines</div>
          ${sa.topSearchedMedicines.length
            ? pieChart3D(sa.topSearchedMedicines.map(m => ({ label: m.name, value: m.count })))
            : `<div class="empty-state" style="padding:24px;"><div class="icon">&#128202;</div><p class="text-sm">Search for a medicine to see your top picks here.</p></div>`}
        </div>

        <div>
          <div class="card-title" style="margin-top:0;">Recent Reservations</div>
          <div class="card">
            ${data.recentReservations.length ? `
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Medicine</th><th>Qty</th><th>Pharmacy</th><th>Status</th><th>Reserved</th></tr></thead>
                  <tbody>
                    ${data.recentReservations.map(r => `
                      <tr>
                        <td>${escapeHtml(r.medicine_name)}</td>
                        <td>${r.quantity}</td>
                        <td>${escapeHtml(r.pharmacy_name)}</td>
                        <td>${statusBadge(r.status)}</td>
                        <td class="muted text-sm">${new Date(r.reserved_at).toLocaleString()}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            ` : `
              <div class="empty-state">
                <div class="icon">&#128203;</div>
                <h3>No reservations yet</h3>
                <p>Search for a medicine and reserve it at a nearby pharmacy.</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
})();
