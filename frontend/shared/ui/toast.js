import { createElement } from '../dom-safe.js';

const TOAST_TONES = {
  success: 'toast-success',
  error: 'toast-error',
  warning: 'toast-warning',
  info: 'toast-info'
};

export function createToastManager({ container } = {}) {
  const host = typeof container === 'string' ? document.getElementById(container) : container;

  function show({ title = 'Info', message = '', tone = 'info', duration = 3500 } = {}) {
    if (!host) return null;

    const toast = createElement('div', { className: `toast ${TOAST_TONES[tone] || TOAST_TONES.info}` });
    const titleEl = createElement('div', { className: 'toast-title', text: title });
    const messageEl = createElement('div', { className: 'toast-message', text: message });
    const closeBtn = createElement('button', { className: 'toast-close', attrs: { type: 'button', 'aria-label': 'Close toast' } });
    closeBtn.textContent = 'x';

    closeBtn.addEventListener('click', () => toast.remove());

    toast.appendChild(titleEl);
    toast.appendChild(messageEl);
    toast.appendChild(closeBtn);
    host.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 200);
      }, duration);
    }

    return toast;
  }

  return { show };
}
