import { WS_RECONNECT } from './config.js';

export function normalizeWsEndpoint(endpoint) {
  if (!endpoint) return '';
  let normalized = String(endpoint).trim();
  if (!normalized) return '';
  if (normalized.startsWith('https://')) normalized = `wss://${normalized.slice(8)}`;
  if (normalized.startsWith('http://')) normalized = `ws://${normalized.slice(7)}`;
  if (!/^wss?:\/\//i.test(normalized)) return '';
  return normalized;
}

function parseMessage(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function createRealtimeChannel({
  name = 'realtime',
  getUrl,
  onMessage,
  onOpen,
  onClose,
  onError,
  initialDelayMs = WS_RECONNECT.initialDelayMs,
  maxDelayMs = WS_RECONNECT.maxDelayMs
} = {}) {
  let socket = null;
  let reconnectTimer = null;
  let shouldReconnect = true;
  let reconnectDelayMs = initialDelayMs;
  let connectContext = null;
  const debounceTimers = new Map();

  function clearDebounceTimers() {
    debounceTimers.forEach((timerId) => clearTimeout(timerId));
    debounceTimers.clear();
  }

  function queue(key, callback, delay = WS_RECONNECT.debounceMs) {
    if (!key || typeof callback !== 'function') return;
    const active = debounceTimers.get(key);
    if (active) clearTimeout(active);
    const next = setTimeout(async () => {
      debounceTimers.delete(key);
      try {
        await callback();
      } catch (error) {
        console.error(`[${name}] debounced callback failed`, error);
      }
    }, delay);
    debounceTimers.set(key, next);
  }

  function isConnected() {
    return socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
  }

  function scheduleReconnect() {
    if (!shouldReconnect || reconnectTimer) return;
    const delay = reconnectDelayMs;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(connectContext);
    }, delay);
    reconnectDelayMs = Math.min(delay * 2, maxDelayMs);
  }

  function disconnect({ allowReconnect = false } = {}) {
    shouldReconnect = allowReconnect;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (!socket) return;
    const active = socket;
    socket = null;

    active.onopen = null;
    active.onmessage = null;
    active.onclose = null;
    active.onerror = null;

    try {
      active.close(1000, 'client_closed');
    } catch {
      // Ignore close errors.
    }
  }

  async function connect(context = connectContext) {
    connectContext = context;
    if (isConnected()) return socket;

    let url = '';
    try {
      url = await getUrl(context);
    } catch (error) {
      console.warn(`[${name}] resolve url failed`, error);
      scheduleReconnect();
      return null;
    }

    if (!url) {
      scheduleReconnect();
      return null;
    }

    shouldReconnect = true;
    const nextSocket = new WebSocket(url);
    socket = nextSocket;

    nextSocket.onopen = () => {
      reconnectDelayMs = initialDelayMs;
      if (typeof onOpen === 'function') onOpen(nextSocket, context);
    };

    nextSocket.onmessage = (event) => {
      if (typeof onMessage !== 'function') return;
      const parsed = parseMessage(event.data);
      onMessage(parsed || event.data, event, context);
    };

    nextSocket.onclose = (event) => {
      if (socket === nextSocket) socket = null;
      if (typeof onClose === 'function') onClose(event, context);
      scheduleReconnect();
    };

    nextSocket.onerror = (error) => {
      if (typeof onError === 'function') onError(error, context);
      else console.error(`[${name}] websocket error`, error);
    };

    return nextSocket;
  }

  return {
    connect,
    disconnect,
    scheduleReconnect,
    queue,
    clearDebounceTimers,
    get socket() {
      return socket;
    },
    setShouldReconnect(value) {
      shouldReconnect = Boolean(value);
    },
    resetBackoff() {
      reconnectDelayMs = initialDelayMs;
    }
  };
}
