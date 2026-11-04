// Small helpers for tenant referencing.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = p => '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });
const when = t => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '';
const day = t => t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '';
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
module.exports = { esc, gbp, when, day, clip };
