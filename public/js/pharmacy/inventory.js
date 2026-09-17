(async function () {
  const user = await guardPage(['pharmacy_staff'], 'My Inventory', 'Organize products into folders and deploy them together');
  if (!user) return;
  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="flex justify-between items-center mt-8" style="flex-wrap:wrap;gap:10px;">
      <div></div>
      <div class="flex gap-8">
        <button class="btn btn-outline" id="add-folder-btn">+ Add Folder</button>
        <button class="btn btn-primary" id="add-btn">+ Add Medicine</button>
      </div>
    </div>
    <div id="add-folder-form" class="card mt-16" style="display:none;"></div>
    <div id="add-form" class="card mt-16" style="display:none;"></div>

    <div class="grid mt-16" style="grid-template-columns: 2fr 1fr; gap:18px; align-items:flex-start;">
      <div>
        <div class="card-title" style="margin-top:0;">Folders</div>
        <div id="folders-list"></div>
      </div>
      <div>
        <div class="card-title" style="margin-top:0;">Recent Deploy History</div>
        <div class="card stat-card" style="margin-bottom:14px;">
          <div class="stat-label">Estimated Value of Deployed Stock</div>
          <div class="stat-value" id="deployed-value">—</div>
          <div class="text-sm muted" id="deployed-count"></div>
        </div>
        <div class="card mb-12" style="margin-bottom:12px;">
          <div class="field"><label>Filter by Month</label><input type="month" id="filter-month" /></div>
          <div class="field"><label>Filter by Folder</label><select id="filter-folder"><option value="">All folders</option></select></div>
          <div class="field"><label>Search Product/Folder</label><input type="text" id="filter-q" placeholder="e.g. Paracetamol" /></div>
        </div>
        <div class="card" style="padding:0;">
          <div id="deploy-history"></div>
        </div>
      </div>
    </div>
  `;

  const foldersList = document.getElementById('folders-list');
  const addForm = document.getElementById('add-form');
  const addFolderForm = document.getElementById('add-folder-form');
  let allMedicines = [];
  let allFolders = [];
  const expanded = new Set();

  function statusBadge(status) {
    const map = {
      draft: '<span class="badge badge-draft">Draft</span>',
      ready: '<span class="badge badge-ready">Ready to Deploy</span>',
      deployed: '<span class="badge badge-deployed">Deployed</span>',
      archived: '<span class="badge badge-archived">Archived</span>',
    };
    return map[status] || status;
  }

  // ---- Add Folder ----
  document.getElementById('add-folder-btn').addEventListener('click', () => {
    addFolderForm.style.display = addFolderForm.style.display === 'none' ? 'block' : 'none';
    addFolderForm.innerHTML = `
      <div class="card-title">New Folder</div>
      <div class="field"><label>Folder Name</label><input type="text" id="folder-name" placeholder="e.g. Cold & Flu Bundle" /></div>
      <button class="btn btn-primary" id="save-folder">Create Folder</button>
      <button class="btn btn-outline" id="cancel-folder">Cancel</button>
    `;
    document.getElementById('cancel-folder').addEventListener('click', () => addFolderForm.style.display = 'none');
    document.getElementById('save-folder').addEventListener('click', async () => {
      const name = document.getElementById('folder-name').value.trim();
      if (!name) { toast('Folder name is required.', 'error'); return; }
      try {
        await Api.post('/api/pharmacy/folders', { name });
        toast('Folder created.');
        addFolderForm.style.display = 'none';
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // ---- Add Medicine (to a folder or unassigned) ----
  function renderAddForm() {
    addForm.innerHTML = `
      <div class="card-title">Add Medicine to Inventory</div>
      <div class="grid grid-4">
        <div class="field">
          <label>Medicine</label>
          <select id="medicine_id">${allMedicines.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
        </div>
        <div class="field">
          <label>Folder</label>
          <select id="folder_id">
            <option value="">Unassigned</option>
            ${allFolders.map(f => `<option value="${f.id}">${escapeHtml(f.name)} (${f.status})</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Brand</label><input type="text" id="brand" placeholder="e.g. Biogesic" /></div>
        <div class="field"><label>Price (₱)</label><input type="number" id="price" min="0" step="0.01" /></div>
      </div>
      <div class="grid grid-4">
        <div class="field"><label>Stock Quantity</label><input type="number" id="stock_quantity" min="0" /></div>
        <div class="field"><label>Low Stock Alert Below</label><input type="number" id="low_stock_threshold" value="10" min="0" /></div>
      </div>
      <button class="btn btn-primary" id="save-add">Add to Inventory</button>
      <button class="btn btn-outline" id="cancel-add">Cancel</button>
      <p class="text-sm muted mt-16">Products become visible to customers only when the <strong>folder</strong> they belong to is deployed.</p>
    `;
    document.getElementById('cancel-add').addEventListener('click', () => addForm.style.display = 'none');
    document.getElementById('save-add').addEventListener('click', async () => {
      try {
        await Api.post('/api/pharmacy/inventory', {
          medicine_id: document.getElementById('medicine_id').value,
          folder_id: document.getElementById('folder_id').value || null,
          brand: document.getElementById('brand').value.trim(),
          price: parseFloat(document.getElementById('price').value),
          stock_quantity: parseInt(document.getElementById('stock_quantity').value, 10),
          low_stock_threshold: parseInt(document.getElementById('low_stock_threshold').value, 10),
        });
        toast('Medicine added to inventory.');
        addForm.style.display = 'none';
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  document.getElementById('add-btn').addEventListener('click', () => {
    addForm.style.display = addForm.style.display === 'none' ? 'block' : 'none';
  });

  function productRow(item) {
    return `
      <tr>
        <td>
          <div style="font-weight:600">${escapeHtml(item.medicine_name)}</div>
          <div class="text-sm muted">${escapeHtml(item.category || '')}</div>
        </td>
        <td><input type="text" class="edit-brand" data-id="${item.id}" value="${escapeHtml(item.brand || '')}" placeholder="Brand" style="width:100px;padding:6px;border:1px solid var(--border);border-radius:6px;" /></td>
        <td><input type="number" class="edit-price" data-id="${item.id}" value="${item.price}" step="0.01" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:6px;" /></td>
        <td><input type="number" class="edit-stock" data-id="${item.id}" value="${item.stock_quantity}" style="width:70px;padding:6px;border:1px solid var(--border);border-radius:6px;" /></td>
        <td>${stockBadge(item.stock_quantity, item.low_stock_threshold)}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-outline btn-sm save-btn" data-id="${item.id}">Save</button>
          <select class="move-folder-select" data-id="${item.id}" style="padding:5px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
            <option value="">Unassigned</option>
            ${allFolders.map(f => `<option value="${f.id}" ${item.folder_id === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
          </select>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${item.id}">Delete</button>
        </td>
      </tr>
    `;
  }

  function folderCard(folder) {
    const products = folder._products || [];
    const isOpen = expanded.has(folder.id);
    const canDeploy = folder.status !== 'deployed' && folder.status !== 'archived' && folder.product_count > 0;
    const canUndeploy = folder.status === 'deployed';
    const canReady = folder.status === 'draft' && folder.product_count > 0;
    const canArchive = folder.status !== 'archived';
    return `
      <div class="folder-card fade-in-up">
        <div class="folder-head" data-toggle="${folder.id}">
          <div class="folder-head-left">
            <span class="folder-chevron ${isOpen ? 'open' : ''}">&#9656;</span>
            <div class="folder-icon">&#128193;</div>
            <div>
              <div class="folder-name">${escapeHtml(folder.name)}</div>
              <div class="folder-meta">${folder.product_count} product(s) &middot; ${money(folder.estimated_value)} est. value</div>
            </div>
          </div>
          <div class="flex items-center gap-8" style="flex-wrap:wrap;">
            ${statusBadge(folder.status)}
            ${canReady ? `<button class="btn btn-outline btn-sm ready-btn" data-id="${folder.id}">Mark Ready</button>` : ''}
            ${canDeploy ? `<button class="btn btn-primary btn-sm deploy-folder-btn" data-id="${folder.id}">Deploy</button>` : ''}
            ${canUndeploy ? `<button class="btn btn-outline btn-sm undeploy-folder-btn" data-id="${folder.id}">Undeploy</button>` : ''}
            ${canArchive ? `<button class="btn btn-outline btn-sm archive-folder-btn" data-id="${folder.id}">Archive</button>` : ''}
            <button class="btn btn-outline btn-sm rename-folder-btn" data-id="${folder.id}" data-name="${escapeHtml(folder.name)}">Rename</button>
            <button class="btn btn-danger btn-sm delete-folder-btn" data-id="${folder.id}">Delete</button>
          </div>
        </div>
        <div class="folder-body ${isOpen ? 'open' : ''}" id="folder-body-${folder.id}">
          ${products.length ? `
            <table>
              <thead><tr><th>Medicine</th><th>Brand</th><th>Price (₱)</th><th>Stock</th><th>Status</th><th></th></tr></thead>
              <tbody>${products.map(productRow).join('')}</tbody>
            </table>
          ` : `<p class="text-sm muted">No products in this folder yet. Use "+ Add Medicine" above and assign it here.</p>`}
        </div>
      </div>
    `;
  }

  function wireProductRows() {
    document.querySelectorAll('.save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const price = parseFloat(document.querySelector(`.edit-price[data-id="${id}"]`).value);
        const stock_quantity = parseInt(document.querySelector(`.edit-stock[data-id="${id}"]`).value, 10);
        const brand = document.querySelector(`.edit-brand[data-id="${id}"]`).value;
        try {
          await Api.put(`/api/pharmacy/inventory/${id}`, { price, stock_quantity, brand });
          toast('Inventory updated.');
          load();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    document.querySelectorAll('.move-folder-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await Api.put(`/api/pharmacy/inventory/${sel.dataset.id}/move`, { folder_id: sel.value || null });
          toast('Product moved.');
          load();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this medicine from your inventory?')) return;
        try {
          await Api.del(`/api/pharmacy/inventory/${btn.dataset.id}`);
          toast('Removed from inventory.');
          load();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function wireFolderActions() {
    document.querySelectorAll('[data-toggle]').forEach(head => {
      head.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('select')) return;
        const id = Number(head.dataset.toggle);
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        render();
      });
    });
    document.querySelectorAll('.ready-btn').forEach(btn => btn.addEventListener('click', async () => {
      try { await Api.post(`/api/pharmacy/folders/${btn.dataset.id}/ready`); toast('Folder marked ready to deploy.'); load(); }
      catch (err) { toast(err.message, 'error'); }
    }));
    document.querySelectorAll('.deploy-folder-btn').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const res = await Api.post(`/api/pharmacy/folders/${btn.dataset.id}/deploy`);
        toast(`Folder deployed — ${res.product_count} product(s) now visible to customers.`);
        load(); loadDeployHistory();
      } catch (err) { toast(err.message, 'error'); }
    }));
    document.querySelectorAll('.undeploy-folder-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Undeploy this folder? Its products will no longer be visible to customers.')) return;
      try { await Api.post(`/api/pharmacy/folders/${btn.dataset.id}/undeploy`); toast('Folder undeployed.'); load(); loadDeployHistory(); }
      catch (err) { toast(err.message, 'error'); }
    }));
    document.querySelectorAll('.archive-folder-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Archive this folder? It will be hidden from customers and marked archived.')) return;
      try { await Api.post(`/api/pharmacy/folders/${btn.dataset.id}/archive`); toast('Folder archived.'); load(); loadDeployHistory(); }
      catch (err) { toast(err.message, 'error'); }
    }));
    document.querySelectorAll('.rename-folder-btn').forEach(btn => btn.addEventListener('click', async () => {
      const name = prompt('Rename folder to:', btn.dataset.name);
      if (!name || !name.trim()) return;
      try { await Api.put(`/api/pharmacy/folders/${btn.dataset.id}`, { name: name.trim() }); toast('Folder renamed.'); load(); }
      catch (err) { toast(err.message, 'error'); }
    }));
    document.querySelectorAll('.delete-folder-btn').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete this folder? Its products will become unassigned (and un-deployed) rather than deleted.')) return;
      try { await Api.del(`/api/pharmacy/folders/${btn.dataset.id}`); toast('Folder deleted.'); load(); }
      catch (err) { toast(err.message, 'error'); }
    }));
  }

  let inventoryRows = [];
  function render() {
    if (!allFolders.length && !inventoryRows.filter(r => !r.folder_id).length) {
      foldersList.innerHTML = `<div class="empty-state"><div class="icon">&#128193;</div><h3>No folders yet</h3><p>Create a folder, add your medicines to it, then deploy the whole folder at once.</p></div>`;
      return;
    }
    const foldersWithProducts = allFolders.map(f => ({ ...f, _products: inventoryRows.filter(r => r.folder_id === f.id) }));
    const unassigned = inventoryRows.filter(r => !r.folder_id);
    let html = foldersWithProducts.map(folderCard).join('');
    if (unassigned.length) {
      html += folderCard({ id: 'unassigned', name: 'Unassigned Products', status: 'draft', product_count: unassigned.length, estimated_value: unassigned.reduce((s, p) => s + p.price * p.stock_quantity, 0), _products: unassigned });
    }
    foldersList.innerHTML = html;
    wireFolderActions();
    wireProductRows();
    // "Unassigned" pseudo-folder can't be deployed/renamed/deleted — strip those controls.
    const unassignedHead = document.querySelector('[data-toggle="unassigned"]');
    if (unassignedHead) unassignedHead.querySelectorAll('.deploy-folder-btn, .ready-btn, .rename-folder-btn, .delete-folder-btn, .archive-folder-btn').forEach(el => el.remove());
  }

  async function loadDeployHistory() {
    const box = document.getElementById('deploy-history');
    const month = document.getElementById('filter-month').value;
    const folder_id = document.getElementById('filter-folder').value;
    const q = document.getElementById('filter-q').value.trim();
    try {
      const params = new URLSearchParams();
      if (month) params.set('month', month);
      if (folder_id) params.set('folder_id', folder_id);
      if (q) params.set('q', q);
      const data = await Api.get('/api/pharmacy/deploy-log?' + params.toString());
      document.getElementById('deployed-value').textContent = money(data.deployedStats.estimatedValue);
      document.getElementById('deployed-count').textContent = `${data.deployedStats.deployedCount} product(s) currently deployed`;
      if (!data.history.length) {
        box.innerHTML = `<div class="empty-state" style="padding:24px;"><p class="text-sm">No deploy activity found.</p></div>`;
        return;
      }
      box.innerHTML = data.history.map(h => `
        <div class="deploy-history-item" style="align-items:flex-start;">
          <div class="flex items-center gap-8">
            <span class="deploy-dot ${h.action === 'deployed' ? 'on' : 'off'}"></span>
            <div>
              <div style="font-weight:600">${escapeHtml(h.folder_name)}</div>
              <div class="text-sm muted">${h.action === 'deployed' ? 'Deployed' : 'Undeployed'} &middot; ${h.product_count} product(s)</div>
              ${h.products && h.products.length ? `<div class="text-sm muted mt-8">${h.products.slice(0, 4).map(p => escapeHtml(p.name)).join(', ')}${h.products.length > 4 ? `, +${h.products.length - 4} more` : ''}</div>` : ''}
            </div>
          </div>
          <div class="text-sm muted" style="white-space:nowrap;">${new Date(h.created_at).toLocaleDateString()}</div>
        </div>
      `).join('');
    } catch (err) {
      box.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function load() {
    try {
      const [invData, folderData] = await Promise.all([
        Api.get('/api/pharmacy/inventory'),
        Api.get('/api/pharmacy/folders'),
      ]);
      allMedicines = invData.medicines;
      allFolders = folderData.folders;
      inventoryRows = invData.inventory;
      renderAddForm();

      const folderFilter = document.getElementById('filter-folder');
      folderFilter.innerHTML = `<option value="">All folders</option>${allFolders.map(f => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}`;

      render();
    } catch (err) {
      foldersList.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  document.getElementById('filter-month').addEventListener('change', loadDeployHistory);
  document.getElementById('filter-folder').addEventListener('change', loadDeployHistory);
  let qTimer;
  document.getElementById('filter-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(loadDeployHistory, 300); });

  load();
  loadDeployHistory();
})();
