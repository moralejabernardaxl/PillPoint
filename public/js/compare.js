(async function () {
  const user = await guardPage(['customer'], 'Price Comparison', 'Compare a medicine\'s price across every pharmacy that carries it');
  if (!user) return;

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="card">
      <div class="filters-row">
        <div class="field grow">
          <label>Search a medicine to compare</label>
          <input type="text" id="q" placeholder="e.g. Amoxicillin" />
        </div>
        <div class="field" style="align-self:flex-end;">
          <button class="btn btn-primary" id="search-btn">Search</button>
        </div>
      </div>
      <div id="medicine-picks"></div>
    </div>
    <div id="compare-results" class="mt-24"></div>
  `;

  const qInput = document.getElementById('q');
  const picks = document.getElementById('medicine-picks');
  const resultsBox = document.getElementById('compare-results');

  async function search() {
    picks.innerHTML = `<div class="muted text-sm mt-16">Searching...</div>`;
    try {
      const data = await Api.get('/api/customer/medicines/search?q=' + encodeURIComponent(qInput.value.trim()));
      const uniqueMeds = [...new Map(data.results.map(r => [r.medicine_id, r.medicine_name])).entries()];
      if (!uniqueMeds.length) {
        picks.innerHTML = `<div class="muted text-sm mt-16">No medicines found.</div>`;
        return;
      }
      picks.innerHTML = `<div class="flex gap-8 mt-16" style="flex-wrap:wrap;">
        ${uniqueMeds.map(([id, name]) => `<button class="btn btn-outline btn-sm pick-btn" data-id="${id}">${escapeHtml(name)}</button>`).join('')}
      </div>`;
      document.querySelectorAll('.pick-btn').forEach(b => b.addEventListener('click', () => loadCompare(b.dataset.id)));
      if (uniqueMeds.length === 1) loadCompare(uniqueMeds[0][0]);
    } catch (err) {
      picks.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadCompare(medicineId) {
    resultsBox.innerHTML = `<div class="empty-state">Loading...</div>`;
    try {
      const data = await Api.get(`/api/customer/medicines/${medicineId}/compare`);
      if (!data.offers.length) {
        resultsBox.innerHTML = `<div class="empty-state"><h3>No pharmacies carry this yet</h3></div>`;
        return;
      }
      resultsBox.innerHTML = `
        <div class="card">
          <div class="card-title">${escapeHtml(data.medicine.name)} — ${data.offers.length} pharmac${data.offers.length === 1 ? 'y' : 'ies'} found</div>
          <table>
            <thead><tr><th>Pharmacy</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${data.offers.map((o, i) => `
                <tr>
                  <td>
                    ${escapeHtml(o.pharmacy_name)} ${i === 0 ? '<span class="badge badge-available">Best price</span>' : ''}
                    ${o.verified ? '' : '<div class="text-sm muted">Unverified pharmacy</div>'}
                    <div class="text-sm muted">${escapeHtml(o.address)}</div>
                  </td>
                  <td style="font-weight:700">${money(o.price)}</td>
                  <td>${o.stock_quantity}</td>
                  <td>${stockBadge(o.stock_quantity, 10)}</td>
                  <td>
                    <button class="btn btn-primary btn-sm reserve-btn" data-id="${o.inventory_id}"
                      data-name="${escapeHtml(data.medicine.name)}" data-max="${o.stock_quantity}"
                      ${o.stock_quantity === 0 ? 'disabled' : ''}>Reserve</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      `;
      document.querySelectorAll('.reserve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const qtyStr = prompt(`Reserve how many units of "${btn.dataset.name}"? (max ${btn.dataset.max})`, '1');
          if (qtyStr === null) return;
          const qty = parseInt(qtyStr, 10);
          if (!qty || qty < 1 || qty > parseInt(btn.dataset.max, 10)) { toast('Invalid quantity', 'error'); return; }
          try {
            await Api.post('/api/customer/reservations', { inventory_id: btn.dataset.id, quantity: qty });
            toast('Reservation placed!');
            loadCompare(medicineId);
          } catch (err) { toast(err.message, 'error'); }
        });
      });
    } catch (err) {
      resultsBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  document.getElementById('search-btn').addEventListener('click', search);
  qInput.addEventListener('keydown', e => { if (e.key === 'Enter') search(); });
})();
