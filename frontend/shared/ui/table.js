import { clearChildren, createElement } from '../dom-safe.js';

export function renderTable(target, {
  columns = [],
  rows = [],
  emptyText = 'No records'
} = {}) {
  const host = typeof target === 'string' ? document.getElementById(target) : target;
  if (!host) return;

  clearChildren(host);

  if (!rows.length) {
    const empty = createElement('div', { className: 'table-empty', text: emptyText });
    host.appendChild(empty);
    return;
  }

  const table = createElement('table', { className: 'table' });
  const thead = createElement('thead');
  const headRow = createElement('tr');

  columns.forEach((column) => {
    headRow.appendChild(createElement('th', { text: column.label || column.key || '' }));
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = createElement('tbody');
  rows.forEach((row) => {
    const tr = createElement('tr');
    columns.forEach((column) => {
      const td = createElement('td');
      const value = typeof column.render === 'function'
        ? column.render(row)
        : row[column.key];

      if (value instanceof Node) td.appendChild(value);
      else td.textContent = value === null || value === undefined ? '' : String(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  host.appendChild(table);
}
