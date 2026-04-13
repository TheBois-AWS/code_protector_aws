import { NETWORK_MESSAGES } from './config.js';

export function createNetworkBanner({
  banner,
  text,
  retryButton,
  onRetry
} = {}) {
  const bannerEl = typeof banner === 'string' ? document.getElementById(banner) : banner;
  const textEl = typeof text === 'string' ? document.getElementById(text) : text;
  const retryEl = typeof retryButton === 'string' ? document.getElementById(retryButton) : retryButton;

  function setVisible(visible, message) {
    if (!bannerEl) return;
    if (textEl) textEl.textContent = message || NETWORK_MESSAGES.connectionIssue;
    bannerEl.classList.toggle('show', Boolean(visible));
  }

  if (retryEl && typeof onRetry === 'function') {
    retryEl.addEventListener('click', () => onRetry());
  }

  return { setVisible, bannerEl, textEl, retryEl };
}

export function bindOnlineOffline({
  onOnline,
  onOffline,
  onlineMessage = '',
  offlineMessage = NETWORK_MESSAGES.offline
} = {}) {
  const handleOnline = () => {
    if (typeof onOnline === 'function') onOnline(onlineMessage);
  };

  const handleOffline = () => {
    if (typeof onOffline === 'function') onOffline(offlineMessage);
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

export function bindApiNetworkEvents({ onNetworkError, onServerError } = {}) {
  const handleNetwork = () => {
    if (typeof onNetworkError === 'function') onNetworkError(NETWORK_MESSAGES.networkError);
  };

  const handleServer = () => {
    if (typeof onServerError === 'function') onServerError(NETWORK_MESSAGES.serverBusy);
  };

  window.addEventListener('app:api:network-error', handleNetwork);
  window.addEventListener('app:api:server-error', handleServer);

  return () => {
    window.removeEventListener('app:api:network-error', handleNetwork);
    window.removeEventListener('app:api:server-error', handleServer);
  };
}
