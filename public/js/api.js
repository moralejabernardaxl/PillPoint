// api.js — thin fetch wrapper for the PillPoint REST API
const Api = {
  async request(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  del(url) { return this.request('DELETE', url); },
};

function toast(message, type = 'ok') {
  let box = document.getElementById('toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  const item = document.createElement('div');
  item.className = `toast-item ${type}`;
  item.textContent = message;
  box.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

function money(n) {
  return '₱' + Number(n).toFixed(2);
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${escapeHtml(status)}</span>`;
}

function stockBadge(qty, threshold) {
  if (qty === 0) return '<span class="badge badge-out">Out of Stock</span>';
  if (qty <= (threshold ?? 10)) return '<span class="badge badge-low">Low Stock</span>';
  return '<span class="badge badge-available">Available</span>';
}

const PIE_COLORS = ['#14B8A6', '#0B1220', '#F59E0B', '#3B82F6', '#EF4444', '#8B5CF6'];

// Builds an inline SVG pie/donut chart + legend markup from [{label, value}].
// Pure vanilla SVG (no chart library) so it works with the no-build-step frontend.
function pieChartSvg(items, opts = {}) {
  const size = opts.size || 180;
  const r = size / 2;
  const inner = opts.donut ? r * 0.55 : 0;
  const total = items.reduce((s, i) => s + i.value, 0);

  if (!total) {
    return `<div class="empty-state" style="padding:24px;"><p class="text-sm">No data yet</p></div>`;
  }

  let angle = -90; // start at 12 o'clock
  const slices = items.map((item, idx) => {
    const color = item.color || PIE_COLORS[idx % PIE_COLORS.length];
    const fraction = item.value / total;
    const startAngle = angle;
    const endAngle = angle + fraction * 360;
    angle = endAngle;

    const toXY = (deg) => {
      const rad = (deg * Math.PI) / 180;
      return [r + r * Math.cos(rad), r + r * Math.sin(rad)];
    };
    const [x1, y1] = toXY(startAngle);
    const [x2, y2] = toXY(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;

    // Full circle edge case (single slice = 100%)
    if (fraction >= 0.999) {
      return `<circle cx="${r}" cy="${r}" r="${r}" fill="${color}" />`;
    }

    return `<path d="M ${r} ${r} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z" fill="${color}" stroke="#fff" stroke-width="1.5" />`;
  }).join('');

  const donutHole = inner ? `<circle cx="${r}" cy="${r}" r="${inner}" fill="#fff" />` : '';

  const legend = items.map((item, idx) => {
    const color = item.color || PIE_COLORS[idx % PIE_COLORS.length];
    const pct = Math.round((item.value / total) * 100);
    return `
      <div class="flex items-center gap-8" style="margin-bottom:8px;">
        <span style="width:11px;height:11px;border-radius:3px;background:${color};flex-shrink:0;display:inline-block;"></span>
        <span class="text-sm" style="flex:1;">${escapeHtml(item.label)}</span>
        <span class="text-sm muted" style="font-weight:700;">${item.value} &middot; ${pct}%</span>
      </div>`;
  }).join('');

  return `
    <div class="flex items-center gap-12" style="flex-wrap:wrap;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0;">
        ${slices}
        ${donutHole}
      </svg>
      <div style="flex:1;min-width:160px;">${legend}</div>
    </div>
  `;
}

// Builds a pseudo-3D "tilted" pie/donut chart from [{label, value}] — same flat
// SVG pie as pieChartSvg, but rendered on a tilted plane with a grounding
// shadow and drop-shadow so it reads as a 3D disc rather than a flat circle.
// Pure CSS 3D transform (no chart library), so it still works with the
// no-build-step frontend.
// Renders a Monday→Sunday reservation-activity bar chart from parallel
// labels/counts arrays (as returned by /dashboard and /analytics).
function weekdayBarChart(labels, counts) {
  const max = Math.max(1, ...counts);
  return `
    <div class="weekday-chart">
      ${labels.map((label, i) => {
        const count = counts[i] || 0;
        const pct = Math.max(4, Math.round((count / max) * 100));
        return `
          <div class="weekday-col">
            <div class="weekday-count">${count}</div>
            <div class="weekday-bar" style="height:${pct}%;"></div>
            <div class="weekday-label">${label}</div>
          </div>`;
      }).join('')}
    </div>
  `;
}

function pieChart3D(items, opts = {}) {
  const size = opts.size || 200;
  const r = size / 2;
  const inner = opts.donut === false ? 0 : r * 0.5;
  const total = items.reduce((s, i) => s + i.value, 0);

  if (!total) {
    return `<div class="empty-state" style="padding:24px;"><p class="text-sm">No data yet</p></div>`;
  }

  let angle = -90;
  const slices = items.map((item, idx) => {
    const color = item.color || PIE_COLORS[idx % PIE_COLORS.length];
    const fraction = item.value / total;
    const startAngle = angle;
    const endAngle = angle + fraction * 360;
    angle = endAngle;
    const toXY = (deg) => {
      const rad = (deg * Math.PI) / 180;
      return [r + r * Math.cos(rad), r + r * Math.sin(rad)];
    };
    const [x1, y1] = toXY(startAngle);
    const [x2, y2] = toXY(endAngle);
    const largeArc = fraction > 0.5 ? 1 : 0;
    if (fraction >= 0.999) {
      return `<circle cx="${r}" cy="${r}" r="${r}" fill="${color}" />`;
    }
    return `<path d="M ${r} ${r} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z" fill="${color}" stroke="rgba(255,255,255,0.55)" stroke-width="1.5" />`;
  }).join('');

  const donutHole = inner ? `<circle cx="${r}" cy="${r}" r="${inner}" fill="#fff" />` : '';

  const legend = items.map((item, idx) => {
    const color = item.color || PIE_COLORS[idx % PIE_COLORS.length];
    const pct = Math.round((item.value / total) * 100);
    return `
      <div class="flex items-center gap-8" style="margin-bottom:8px;">
        <span style="width:11px;height:11px;border-radius:3px;background:${color};flex-shrink:0;display:inline-block;"></span>
        <span class="text-sm" style="flex:1;">${escapeHtml(item.label)}</span>
        <span class="text-sm muted" style="font-weight:700;">${item.value} &middot; ${pct}%</span>
      </div>`;
  }).join('');

  return `
    <div class="pie3d-wrap">
      <div style="width:${size}px;flex-shrink:0;">
        <div class="pie3d-stage" style="width:${size}px;height:${size}px;perspective:700px;">
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
               style="display:block;transform:rotateX(48deg) rotateZ(0deg);transform-style:preserve-3d;">
            ${slices}
            ${donutHole}
          </svg>
        </div>
        <div class="pie3d-shadow"></div>
      </div>
      <div style="flex:1;min-width:160px;">${legend}</div>
    </div>
  `;
}
