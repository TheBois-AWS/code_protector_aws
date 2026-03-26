import { clearChildren, createElement } from '../dom-safe.js';

export function renderSkeletonRows(target, count = 3, className = 'skeleton-row') {
  const host = typeof target === 'string' ? document.getElementById(target) : target;
  if (!host) return;
  clearChildren(host);
  for (let i = 0; i < count; i += 1) {
    host.appendChild(createElement('div', { className }));
  }
}
