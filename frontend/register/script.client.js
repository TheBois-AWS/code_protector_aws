if (window.lucide) {
  window.lucide.createIcons();
}

const AUTH_RETURN_TO_KEY = 'auth_return_to';
const AUTH_DEFAULT_REDIRECT = '/dashboard';

function sanitizeReturnToPath(path) {
  if (!path) return '';
  const value = String(path).trim();
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '';
  if (value.startsWith('/login') || value.startsWith('/register')) return '';
  return value;
}

function getReturnToTarget() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = sanitizeReturnToPath(params.get('returnTo'));
  if (fromQuery) {
    try { localStorage.setItem(AUTH_RETURN_TO_KEY, fromQuery); } catch {}
  }
  const fromStorage = sanitizeReturnToPath(localStorage.getItem(AUTH_RETURN_TO_KEY));
  return fromQuery || fromStorage || AUTH_DEFAULT_REDIRECT;
}

function buildAuthPageLink(basePath, returnTo) {
  const safe = sanitizeReturnToPath(returnTo);
  return safe ? `${basePath}?returnTo=${encodeURIComponent(safe)}` : basePath;
}

function updateAuthLinks(returnTo) {
  const loginLink = buildAuthPageLink('/login', returnTo);
  document.querySelectorAll('a[href="/login"]').forEach((anchor) => {
    anchor.setAttribute('href', loginLink);
  });
}

function redirectAfterAuthSuccess(returnTo) {
  const target = sanitizeReturnToPath(returnTo) || AUTH_DEFAULT_REDIRECT;
  try { localStorage.removeItem(AUTH_RETURN_TO_KEY); } catch {}
  window.location.replace(target);
}

const returnToTarget = getReturnToTarget();
updateAuthLinks(returnToTarget);

(function initMatrixRain() {
  const canvas = document.getElementById('matrixCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  function resize() {
    canvas.width = window.innerWidth * 2;
    canvas.height = window.innerHeight * 2;
  }

  resize();
  window.addEventListener('resize', resize);

  const fontSize = 16;
  let columns = Math.max(10, Math.floor(canvas.width / fontSize));
  let drops = Array(columns).fill(1);

  function draw() {
    const newCols = Math.max(10, Math.floor(canvas.width / fontSize));
    if (newCols !== columns) {
      columns = newCols;
      drops = Array(columns).fill(1);
    }

    ctx.fillStyle = 'rgba(3, 10, 18, 0.16)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontSize + 'px JetBrains Mono, monospace';

    for (let i = 0; i < drops.length; i++) {
      const bit = Math.random() > 0.5 ? '1' : '0';
      ctx.fillStyle = Math.random() > 0.93 ? '#d9f4ff' : '#2dcfbc';
      ctx.fillText(bit, i * fontSize, drops[i] * fontSize);

      if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i] += 1;
    }

    window.requestAnimationFrame(draw);
  }

  draw();
})();

function setStatus(type, message) {
  const status = document.getElementById('status');
  if (!status) return;
  status.className = `status-message show ${type}`;
  status.textContent = message;
}

function setButtonLoading(button, loading, loadingText) {
  if (!button) return;
  const textEl = button.querySelector('.btn-text');

  if (loading) {
    button.disabled = true;
    if (textEl) textEl.textContent = loadingText;
  } else {
    button.disabled = false;
    if (textEl) textEl.textContent = 'Create Account';
  }
}

function initPasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((toggleBtn) => {
    const targetId = toggleBtn.getAttribute('data-password-toggle');
    const input = document.getElementById(targetId);
    if (!input) return;

    toggleBtn.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggleBtn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      const icon = toggleBtn.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', showing ? 'eye' : 'eye-off');
        if (window.lucide) window.lucide.createIcons();
      }
      input.focus();
    });
  });
}

function estimatePasswordScore(password) {
  let score = 0;
  if (!password) return score;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 5);
}

function updatePasswordFeedback() {
  const passwordInput = document.getElementById('password');
  const confirmInput = document.getElementById('confirmPassword');
  const bar = document.getElementById('passwordStrengthBar');
  const label = document.getElementById('passwordStrengthLabel');
  const confirmHint = document.getElementById('confirmPasswordHint');
  if (!passwordInput || !confirmInput || !bar || !label || !confirmHint) return;

  const score = estimatePasswordScore(passwordInput.value);
  const widthPercent = Math.max(8, score * 20);
  bar.style.width = `${widthPercent}%`;

  if (!passwordInput.value) {
    bar.style.width = '0%';
    bar.style.backgroundColor = '#6f86a2';
    label.textContent = 'Use at least 8 characters with mixed letter/number symbols.';
  } else if (score <= 2) {
    bar.style.backgroundColor = '#ff6f7b';
    label.textContent = 'Weak password. Add uppercase, number, and symbol.';
  } else if (score <= 4) {
    bar.style.backgroundColor = '#f7b14b';
    label.textContent = 'Good start. Add one more complexity factor for stronger security.';
  } else {
    bar.style.backgroundColor = '#2dc47a';
    label.textContent = 'Strong password.';
  }

  if (!confirmInput.value) {
    confirmHint.textContent = '';
    return;
  }

  if (passwordInput.value === confirmInput.value) {
    confirmHint.textContent = 'Passwords match.';
    confirmHint.style.color = '#8de6b8';
  } else {
    confirmHint.textContent = 'Passwords do not match.';
    confirmHint.style.color = '#ffb8bf';
  }
}

function initPasswordUx() {
  initPasswordToggles();
  const passwordInput = document.getElementById('password');
  const confirmInput = document.getElementById('confirmPassword');
  if (passwordInput) passwordInput.addEventListener('input', updatePasswordFeedback);
  if (confirmInput) confirmInput.addEventListener('input', updatePasswordFeedback);
  updatePasswordFeedback();
}

initPasswordUx();

(async () => {
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const res = await fetch('/api/user/profile', {
      headers: { Authorization: token }
    });
    if (res.ok) {
      redirectAfterAuthSuccess(returnToTarget);
      return;
    }
  } catch (err) {
    console.error('Profile check failed:', err);
  }

  localStorage.removeItem('token');
})();

const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = registerForm.querySelector('button[type="submit"]');
    const formData = new FormData(registerForm);
    const payload = Object.fromEntries(formData);

    if (payload.password !== payload.confirmPassword) {
      setStatus('error', 'Passwords do not match.');
      return;
    }

    if (!payload.password || payload.password.length < 8) {
      setStatus('error', 'Password must contain at least 8 characters.');
      return;
    }

    setButtonLoading(submitBtn, true, 'Creating Account...');
    setStatus('info', 'Creating your account...');

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (result.success) {
        setStatus('success', 'Registration successful. Redirecting to login...');
        setTimeout(() => {
          const loginRedirect = buildAuthPageLink('/login', returnToTarget);
          window.location.replace(loginRedirect);
        }, 1000);
        return;
      }

      setStatus('error', result.error || 'Registration failed.');
      setButtonLoading(submitBtn, false, 'Creating Account...');
    } catch (err) {
      setStatus('error', 'Connection error. Please try again.');
      setButtonLoading(submitBtn, false, 'Creating Account...');
    }
  });
}
