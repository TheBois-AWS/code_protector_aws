if (window.lucide) {
  window.lucide.createIcons();
}

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
    if (textEl) textEl.textContent = 'Sign In';
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

initPasswordToggles();

(async () => {
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const res = await fetch('/api/user/profile', {
      headers: { Authorization: token }
    });
    if (res.ok) {
      window.location.href = '/dashboard';
      return;
    }
  } catch (err) {
    console.error('Profile check failed:', err);
  }

  localStorage.removeItem('token');
})();

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const formData = new FormData(loginForm);
    const payload = Object.fromEntries(formData);

    setButtonLoading(submitBtn, true, 'Signing In...');
    setStatus('info', 'Processing your sign-in request...');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (result.success) {
        localStorage.setItem('token', result.token);
        setStatus('success', 'Login successful. Redirecting...');
        setTimeout(() => {
          window.location.href = '/dashboard';
        }, 800);
        return;
      }

      setStatus('error', result.error || 'Login failed. Please check your credentials.');
      setButtonLoading(submitBtn, false, 'Signing In...');
    } catch (err) {
      setStatus('error', 'Connection error. Please try again.');
      setButtonLoading(submitBtn, false, 'Signing In...');
    }
  });
}
