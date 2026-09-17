(async function () {
  const user = await guardPage(null, 'Notifications', 'Application and email-logged notifications');
  if (!user) return;

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="flex justify-between items-center mt-8">
      <div></div>
      <button class="btn btn-outline btn-sm" id="mark-all">Mark all as read</button>
    </div>
    <div id="list" class="mt-16"></div>
  `;

  const list = document.getElementById('list');

  async function load() {
    try {
      const data = await Api.get('/api/notifications');
      if (!data.notifications.length) {
        list.innerHTML = `<div class="empty-state"><div class="icon">&#128276;</div><h3>No notifications</h3><p>You're all caught up.</p></div>`;
        return;
      }
      list.innerHTML = data.notifications.map(n => `
        <div class="card" style="margin-bottom:12px; ${n.is_read ? '' : 'border-left:4px solid var(--teal);'}">
          <div class="flex justify-between items-center">
            <div style="font-weight:700">${escapeHtml(n.title)}</div>
            <div class="text-sm muted">${new Date(n.created_at).toLocaleString()}</div>
          </div>
          <p class="text-sm mt-8" style="color:var(--text)">${escapeHtml(n.message)}</p>
          ${n.is_read ? '' : `<button class="btn btn-outline btn-sm mt-16 read-btn" data-id="${n.id}">Mark as read</button>`}
        </div>
      `).join('');
      document.querySelectorAll('.read-btn').forEach(b => {
        b.addEventListener('click', async () => {
          await Api.post(`/api/notifications/${b.dataset.id}/read`);
          load();
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  document.getElementById('mark-all').addEventListener('click', async () => {
    await Api.post('/api/notifications/read-all');
    load();
  });

  load();
})();
