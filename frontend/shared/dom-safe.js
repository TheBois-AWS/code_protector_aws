export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

export function setText(target, value) {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) return;
  element.textContent = value === null || value === undefined ? '' : String(value);
}

export function setValue(target, value) {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) return;
  element.value = value === null || value === undefined ? '' : String(value);
}

export function clearChildren(target) {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) return;
  while (element.firstChild) element.removeChild(element.firstChild);
}

export function appendTextNode(target, value) {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) return;
  element.appendChild(document.createTextNode(value === null || value === undefined ? '' : String(value)));
}

export function createElement(tagName, { className = '', text = '', attrs = {} } = {}) {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  if (text !== '') el.textContent = String(text);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    el.setAttribute(key, String(value));
  });
  return el;
}
