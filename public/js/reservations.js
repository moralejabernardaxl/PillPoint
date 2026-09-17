(async function () {
  const user = await guardPage(['customer'], 'My Reservations', 'Track and manage your medicine reservations');
  if (!user) return;

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="card">
      <div class="filters-row">
        <div class="field">
          <label>Filter by status</label>
          <select id="status-filter">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      <div id="list" class="table-wrap"></div>
    </div>
  `;

  const list = document.getElementById('list');
  const filter = document.getElementById('status-filter');
  let all = [];

  function render() {
    const status = filter.value;
    const rows = status ? all.filter(r => r.status === status) : all;
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state"><div class="icon">&#128203;</div><h3>No reservations</h3><p>Nothing to show for this filter.</p></div>`;
      return;
    }
    list.innerHTML = `
      <table>
        <thead><tr><th>Medicine</th><th>Pharmacy</th><th>Qty</th><th>Price</th><th>Reserved</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${escapeHtml(r.medicine_name)}</td>
              <td>${escapeHtml(r.pharmacy_name)}</td>
              <td>${r.quantity}</td>
              <td>${money(r.price)}</td>
              <td class="text-sm muted">${new Date(r.reserved_at).toLocaleString()}</td>
              <td class="text-sm muted">${r.expires_at ? new Date(r.expires_at).toLocaleDateString() : '—'}</td>
              <td>${statusBadge(r.status)}</td>
              <td>
                ${['pending', 'confirmed'].includes(r.status)
                  ? `<button class="btn btn-danger btn-sm cancel-btn" data-id="${r.id}">Cancel</button>`
                  : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
    document.querySelectorAll('.cancel-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancel this reservation? Stock will be restored.')) return;
        try {
          await Api.post(`/api/customer/reservations/${btn.dataset.id}/cancel`);
          toast('Reservation cancelled.');
          load();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  async function load() {
    try {
      const data = await Api.get('/api/customer/reservations');
      all = data.reservations;
      render();
    } catch (err) {
      list.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  filter.addEventListener('change', render);
  load();
})();
