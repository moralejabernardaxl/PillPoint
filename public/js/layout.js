// layout.js — builds the role-aware sidebar + topbar app shell

const NAV = {
  customer: [
    { href: '/dashboard.html', label: 'Dashboard', icon: '&#8862;' },
    { href: '/search.html', label: 'Search & Nearby', icon: '&#128269;' },
    { href: '/compare.html', label: 'Price Comparison', icon: '&#128176;' },
    { href: '/reservations.html', label: 'My Reservations', icon: '&#128203;' },
    { href: '/notifications.html', label: 'Notifications', icon: '&#128276;' },
    { href: '/profile.html', label: 'Profile', icon: '&#128100;' },
  ],
  pharmacy_staff: [
    { href: '/pharmacy/dashboard.html', label: 'Dashboard', icon: '&#8862;' },
    { href: '/pharmacy/inventory.html', label: 'My Inventory', icon: '&#128137;' },
    { href: '/pharmacy/reservations.html', label: 'Reservations', icon: '&#128203;' },
    { href: '/pharmacy/alerts.html', label: 'Stock Alerts', icon: '&#9888;' },
    { href: '/pharmacy/analytics.html', label: 'Analytics', icon: '&#128202;' },
    { href: '/notifications.html', label: 'Notifications', icon: '&#128276;' },
    { href: '/profile.html', label: 'Profile', icon: '&#128100;' },
  ],
  admin: [
    { href: '/admin/dashboard.html', label: 'Dashboard', icon: '&#8862;' },
    { href: '/admin/pharmacies.html', label: 'Manage Pharmacies', icon: '&#127974;' },
    { href: '/admin/shortages.html', label: 'Shortages', icon: '&#9888;' },
    { href: '/notifications.html', label: 'Notifications', icon: '&#128276;' },
    { href: '/profile.html', label: 'Profile', icon: '&#128100;' },
  ],
};

function buildShell(user, pageTitle, pageSub) {
  const items = NAV[user.role] || [];
  const path = window.location.pathname;
  const navHtml = items.map(i => `
    <a href="${i.href}" class="${path === i.href ? 'active' : ''}">
      <span class="icon">${i.icon}</span>${i.label}
    </a>`).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="/img/logo-mark.svg" alt="PillPoint" class="brand-badge" width="34" height="34" />
          <div class="brand-name">PillPoint</div>
        </div>
        <nav>${navHtml}</nav>
        <div class="divider"></div>
        <a href="#" id="logout-link">
          <span class="icon">&#8630;</span>Logout
        </a>
        <div class="user-box">
          <div class="user-name">${escapeHtml(user.name)}</div>
          <div class="user-role">${escapeHtml(user.role.replace('_', ' '))}</div>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div>
            <h1>${pageTitle}</h1>
            ${pageSub ? `<div class="sub">${pageSub}</div>` : ''}
          </div>
        </div>
        <div class="content" id="page-content"></div>
      </div>
    </div>
  `);

  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await Api.post('/api/auth/logout');
    window.location.href = '/login.html';
  });
}

// Guards a page: redirects to login if not authenticated, or to the correct
// dashboard if authenticated with a different role. Returns the user object.
async function guardPage(allowedRoles, pageTitle, pageSub) {
  let data;
  try {
    data = await Api.get('/api/auth/me');
  } catch (e) {
    window.location.href = '/login.html';
    return null;
  }
  if (!data.user) {
    window.location.href = '/login.html';
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(data.user.role)) {
    window.location.href = roleHome(data.user.role);
    return null;
  }
  buildShell(data.user, pageTitle, pageSub);
  return data.user;
}

function roleHome(role) {
  if (role === 'pharmacy_staff') return '/pharmacy/dashboard.html';
  if (role === 'admin') return '/admin/dashboard.html';
  return '/dashboard.html';
}
