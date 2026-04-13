(async () => {
  const [
    auth,
    { apiJson, installApiClient, createApiError },
    { getStorageItem }
  ] = await Promise.all([
    import('/shared/auth.js'),
    import('/shared/api-client.js'),
    import('/shared/storage.js')
  ]);

  const {
    getResolvedReturnTo,
    buildAuthPageLink,
    redirectAfterAuthSuccess,
    setAuthToken,
    clearAuthSession,
    validateDualSession,
    getAuthToken
  } = auth;

  const returnToTarget = getResolvedReturnTo({ fallback: '/dashboard', persist: true });

  installApiClient({
    onUnauthorized: ({ path }) => {
      if (path && path.startsWith('/api/login')) return;
      clearAuthSession();
    }
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }

  const setStatus = (type, message) => {
    const status = document.getElementById('status');
    if (!status) return;
    status.className = `status-message show ${type}`;
    status.textContent = message;
  };

  const setButtonLoading = (button, loading, loadingText) => {
    if (!button) return;
    const textEl = button.querySelector('.btn-text');

    button.disabled = Boolean(loading);
    if (textEl) textEl.textContent = loading ? loadingText : 'Sign In';
  };

  const updateAuthLinks = (returnTo) => {
    const registerLink = buildAuthPageLink('/register', returnTo);
    document.querySelectorAll('a[href="/register"]').forEach((anchor) => {
      anchor.setAttribute('href', registerLink);
    });
  };

  const initPasswordToggles = () => {
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
  };

  const initMatrixRain = () => {
    const canvas = document.getElementById('matrixCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth * 2;
      canvas.height = window.innerHeight * 2;
    };

    resize();
    window.addEventListener('resize', resize);

    const fontSize = 16;
    let columns = Math.max(10, Math.floor(canvas.width / fontSize));
    let drops = Array(columns).fill(1);

    const draw = () => {
      const newCols = Math.max(10, Math.floor(canvas.width / fontSize));
      if (newCols !== columns) {
        columns = newCols;
        drops = Array(columns).fill(1);
      }

      ctx.fillStyle = 'rgba(3, 10, 18, 0.16)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${fontSize}px JetBrains Mono, monospace`;

      for (let index = 0; index < drops.length; index += 1) {
        const bit = Math.random() > 0.5 ? '1' : '0';
        ctx.fillStyle = Math.random() > 0.93 ? '#d9f4ff' : '#2dcfbc';
        ctx.fillText(bit, index * fontSize, drops[index] * fontSize);

        if (drops[index] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[index] = 0;
        }
        drops[index] += 1;
      }

      window.requestAnimationFrame(draw);
    };

    draw();
  };

  updateAuthLinks(returnToTarget);
  initPasswordToggles();
  initMatrixRain();

  const token = getAuthToken() || getStorageItem('token', '');
  if (token) {
    const session = await validateDualSession({ token });
    if (session.ok) {
      redirectAfterAuthSuccess(returnToTarget, '/dashboard');
      return;
    }
    clearAuthSession();
  }

  const loginForm = document.getElementById('loginForm');
  if (!loginForm) return;

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitBtn = loginForm.querySelector('button[type="submit"]');
    const formData = new FormData(loginForm);
    const payload = Object.fromEntries(formData);

    setButtonLoading(submitBtn, true, 'Signing In...');
    setStatus('info', 'Processing your sign-in request...');

    try {
      const { data } = await apiJson('/api/login', {
        method: 'POST',
        body: payload
      });

      setAuthToken(data.token);
      setStatus('success', 'Login successful. Redirecting...');

      setTimeout(() => {
        redirectAfterAuthSuccess(returnToTarget, '/dashboard');
      }, 700);
    } catch (error) {
      const apiError = error?.name === 'ApiError'
        ? error
        : createApiError({ message: 'Connection error. Please try again.' });

      setStatus('error', apiError.message || 'Login failed. Please check your credentials.');
      setButtonLoading(submitBtn, false, 'Signing In...');
    }
  });
})();
