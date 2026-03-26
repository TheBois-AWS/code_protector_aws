export function on(target, type, handler, options) {
  if (!target || !type || typeof handler !== 'function') {
    return () => {};
  }
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export function once(target, type, handler, options) {
  return on(target, type, handler, { ...(options || {}), once: true });
}

export function delegate(root, eventType, selector, handler, options) {
  if (!root || !selector || typeof handler !== 'function') {
    return () => {};
  }

  const listener = (event) => {
    const candidate = event.target instanceof Element ? event.target.closest(selector) : null;
    if (!candidate || !root.contains(candidate)) return;
    handler(event, candidate);
  };

  root.addEventListener(eventType, listener, options);
  return () => root.removeEventListener(eventType, listener, options);
}

export function emit(target, eventName, detail = {}) {
  if (!target) return;
  target.dispatchEvent(new CustomEvent(eventName, { detail }));
}

const DEFAULT_ACTION_ATTRIBUTES = Object.freeze({
  click: 'data-action-click',
  change: 'data-action-change',
  input: 'data-action-input',
  keyup: 'data-action-keyup',
  keydown: 'data-action-keydown',
  submit: 'data-action-submit'
});

function splitByDelimiter(value, delimiter) {
  const source = String(value || '');
  const parts = [];
  let buffer = '';
  let quote = '';
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const prev = source[index - 1];

    if (quote) {
      buffer += char;
      if (char === quote && prev !== '\\') quote = '';
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      buffer += char;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      buffer += char;
      continue;
    }

    if (char === delimiter && depth === 0) {
      const trimmed = buffer.trim();
      if (trimmed) parts.push(trimmed);
      buffer = '';
      continue;
    }

    buffer += char;
  }

  const trimmed = buffer.trim();
  if (trimmed) parts.push(trimmed);
  return parts;
}

function resolvePath(scope, path, context) {
  if (!path) return undefined;
  const segments = path.split('.').filter(Boolean);
  if (!segments.length) return undefined;

  let current;
  const first = segments[0];
  if (first === 'window') current = window;
  else if (first === 'document') current = document;
  else if (first === 'this') current = context.element;
  else if (first === 'event') current = context.event;
  else {
    current = scope?.[first];
    if (current === undefined && scope !== window) {
      current = window[first];
    }
  }

  for (let index = 1; index < segments.length; index += 1) {
    if (current === null || current === undefined) return undefined;
    current = current[segments[index]];
  }

  return current;
}

function resolveArg(token, context) {
  if (!token) return undefined;
  const value = token.trim();
  if (!value) return undefined;

  if (value === 'event') return context.event;
  if (value === 'this') return context.element;
  if (value === 'this.value') return context.element?.value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value === 'undefined') return undefined;
  if (value === '[]') return [];
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  const quoteMatch = value.match(/^(['"])([\s\S]*)\1$/);
  if (quoteMatch) {
    const escaped = quoteMatch[2]
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"');
    return escaped;
  }

  const docRef = value.match(/^document\.getElementById\((['"])([^'"]+)\1\)\.(value|textContent)$/);
  if (docRef) {
    const el = document.getElementById(docRef[2]);
    return docRef[3] === 'value' ? el?.value : el?.textContent;
  }

  return resolvePath(context.scope, value, context);
}

function assignExpression(statement, context) {
  const locationMatch = statement.match(/^window\.location\.href\s*=\s*(['"])([\s\S]*)\1$/);
  if (locationMatch) {
    window.location.href = locationMatch[2];
    return true;
  }

  const displayMatch = statement.match(/^document\.getElementById\((['"])([^'"]+)\1\)\.style\.display\s*=\s*(['"])([\s\S]*)\3$/);
  if (displayMatch) {
    const target = document.getElementById(displayMatch[2]);
    if (target) target.style.display = displayMatch[4];
    return true;
  }

  const listAssignMatch = statement.match(/^([A-Za-z_$][\w$]*)\s*=\s*\[\s*\]$/);
  if (listAssignMatch) {
    context.scope[listAssignMatch[1]] = [];
    return true;
  }

  return false;
}

function invokeExpression(statement, context) {
  const callMatch = statement.match(/^([A-Za-z_$][\w$.]*)\(([\s\S]*)\)$/);
  if (!callMatch) return undefined;

  const path = callMatch[1];
  const rawArgs = splitByDelimiter(callMatch[2], ',');
  const args = rawArgs.map((arg) => resolveArg(arg, context));

  const segments = path.split('.');
  const methodName = segments.pop();
  const basePath = segments.join('.');
  const base = basePath ? resolvePath(context.scope, basePath, context) : context.scope;
  const fn = base?.[methodName];
  if (typeof fn !== 'function') return undefined;
  return fn.apply(base, args);
}

export function executeActionExpression(expression, {
  event,
  element,
  scope = window,
  onError
} = {}) {
  if (!expression || typeof expression !== 'string') return undefined;

  const context = { event, element, scope: scope || window };
  const statements = splitByDelimiter(expression, ';');
  let lastResult;

  for (const statement of statements) {
    if (statement === 'event.stopPropagation()') {
      event?.stopPropagation?.();
      continue;
    }

    if (statement === 'event.preventDefault()') {
      event?.preventDefault?.();
      continue;
    }

    try {
      if (assignExpression(statement, context)) {
        lastResult = undefined;
        continue;
      }

      const invokeResult = invokeExpression(statement, context);
      if (invokeResult !== undefined) {
        lastResult = invokeResult;
        continue;
      }

      const error = new Error(`Unsupported action expression: ${statement}`);
      if (typeof onError === 'function') onError(error, statement, context);
      else console.warn(error.message);
    } catch (error) {
      if (typeof onError === 'function') onError(error, statement, context);
      else console.error('Action expression failed', statement, error);
    }
  }

  return lastResult;
}

export function installActionAttributes({
  root = document,
  scope = window,
  attributes = DEFAULT_ACTION_ATTRIBUTES,
  onError
} = {}) {
  if (!root) return () => {};

  const unbinds = [];
  Object.entries(attributes || {}).forEach(([eventName, attrName]) => {
    if (!attrName) return;

    const listener = (event) => {
      const target = event.target instanceof Element
        ? event.target.closest(`[${attrName}]`)
        : null;
      if (!target || !root.contains(target)) return;
      const expression = target.getAttribute(attrName);
      const result = executeActionExpression(expression, {
        event,
        element: target,
        scope,
        onError
      });

      if (result === false) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const useCapture = eventName === 'submit';
    root.addEventListener(eventName, listener, useCapture);
    unbinds.push(() => root.removeEventListener(eventName, listener, useCapture));
  });

  return () => {
    unbinds.forEach((unbind) => unbind());
  };
}
