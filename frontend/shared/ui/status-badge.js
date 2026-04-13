import { createElement } from '../dom-safe.js';

function toneForStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'healthy', 'ok', 'approved', 'success'].includes(normalized)) return 'success';
  if (['pending', 'warning', 'degraded'].includes(normalized)) return 'warning';
  if (['inactive', 'suspended', 'error', 'failed', 'deleted', 'disabled'].includes(normalized)) return 'danger';
  return 'neutral';
}

export function createStatusBadge(status, { label } = {}) {
  const tone = toneForStatus(status);
  return createElement('span', {
    className: `status-badge status-${tone}`,
    text: label || String(status || '-').toUpperCase()
  });
}
