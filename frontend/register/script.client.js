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
    clearAuthSession,
    validateDualSession,
    getAuthToken
  } = auth;

  const returnToTarget = getResolvedReturnTo({ fallback: '/dashboard', persist: true });

  installApiClient({
    onUnauthorized: ({ path }) => {
      if (path && path.startsWith('/api/register')) return;
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
    if (textEl) textEl.textContent = loading ? loadingText : 'Create Account';
  };

  const updateAuthLinks = (returnTo) => {
    const loginLink = buildAuthPageLink('/login', returnTo);
    document.querySelectorAll('a[href="/login"]').forEach((anchor) => {
      anchor.setAttribute('href', loginLink);
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

  const estimatePasswordScore = (password) => {
    let score = 0;
    if (!password) return score;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return Math.min(score, 5);
  };

  const updatePasswordFeedback = () => {
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
  };

  const initPasswordUx = () => {
    initPasswordToggles();
    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirmPassword');
    if (passwordInput) passwordInput.addEventListener('input', updatePasswordFeedback);
    if (confirmInput) confirmInput.addEventListener('input', updatePasswordFeedback);
    updatePasswordFeedback();
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
  initPasswordUx();
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

  const registerForm = document.getElementById('registerForm');
  if (!registerForm) return;

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

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
      await apiJson('/api/register', {
        method: 'POST',
        body: payload
      });

      setStatus('success', 'Registration successful. Redirecting to login...');
      setTimeout(() => {
        window.location.replace(buildAuthPageLink('/login', returnToTarget));
      }, 800);
    } catch (error) {
      const apiError = error?.name === 'ApiError'
        ? error
        : createApiError({ message: 'Connection error. Please try again.' });

      setStatus('error', apiError.message || 'Registration failed.');
      setButtonLoading(submitBtn, false, 'Creating Account...');
    }
  });
})();
