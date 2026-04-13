import { createElement } from '../dom-safe.js';

export function createEmptyState({ title = 'No data', description = '', actionLabel = '', actionId = '' } = {}) {
  const wrapper = createElement('div', { className: 'empty-state' });
  const titleEl = createElement('div', { className: 'empty-state-title', text: title });
  const descEl = createElement('div', { className: 'empty-state-description', text: description });

  wrapper.appendChild(titleEl);
  if (description) wrapper.appendChild(descEl);

  if (actionLabel) {
    const button = createElement('button', {
      className: 'empty-state-action',
      text: actionLabel,
      attrs: { type: 'button' }
    });
    if (actionId) button.dataset.action = actionId;
    wrapper.appendChild(button);
  }

  return wrapper;
}
