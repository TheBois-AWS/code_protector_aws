(async () => {
    const [{ getAuthToken }, { on }] = await Promise.all([
        import('/shared/auth.js'),
        import('/shared/events.js')
    ]);

    const setCurrentYear = () => {
        const yearEl = document.getElementById('currentYear');
        if (yearEl) yearEl.textContent = String(new Date().getFullYear());
    };

    const initMobileMenu = () => {
        const button = document.querySelector('.hamburger');
        const nav = document.querySelector('.nav-links');
        if (!button || !nav) return;

        on(button, 'click', () => {
            const opened = nav.classList.toggle('open');
            button.setAttribute('aria-expanded', opened ? 'true' : 'false');
        });

        nav.querySelectorAll('a').forEach((link) => {
            on(link, 'click', () => {
                nav.classList.remove('open');
                button.setAttribute('aria-expanded', 'false');
            });
        });
    };

    const initAuthAwareNav = () => {
        const token = getAuthToken();
        if (!token) return;

        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        const loginBtn = navLinks.querySelector('a[href="/login"]');
        const registerBtn = navLinks.querySelector('a[href="/register"]');
        if (loginBtn) loginBtn.style.display = 'none';
        if (registerBtn) registerBtn.style.display = 'none';

        const heroPrimary = document.querySelector('.hero-btns .btn-primary');
        if (heroPrimary) {
            heroPrimary.textContent = 'Go to Dashboard';
            heroPrimary.setAttribute('href', '/dashboard');
        }

        const userGroup = document.createElement('div');
        userGroup.className = 'user-nav-group';

        const dashboardLink = document.createElement('a');
        dashboardLink.href = '/dashboard';
        dashboardLink.className = 'btn btn-outline';
        dashboardLink.textContent = 'Dashboard';

        const avatar = document.createElement('img');
        avatar.src = 'https://ui-avatars.com/api/?name=User&background=1f5ebf&color=fff&rounded=true&bold=true';
        avatar.className = 'nav-avatar';
        avatar.alt = 'User profile';
        on(avatar, 'click', () => {
            window.location.href = '/dashboard';
        });

        userGroup.appendChild(dashboardLink);
        userGroup.appendChild(avatar);
        navLinks.appendChild(userGroup);
    };

    const initBinaryCanvas = () => {
        const canvas = document.getElementById('binaryLogo');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            const size = Math.floor(canvas.clientWidth * 2);
            canvas.width = size;
            canvas.height = size;
        };

        resize();
        on(window, 'resize', resize);

        const fontSize = 14;
        const columns = Math.max(10, Math.floor(canvas.width / fontSize));
        const drops = Array(columns).fill(1);

        const draw = () => {
            ctx.fillStyle = 'rgba(3, 10, 18, 0.16)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.font = `${fontSize}px JetBrains Mono, monospace`;

            for (let i = 0; i < drops.length; i += 1) {
                const bit = Math.random() > 0.5 ? '1' : '0';
                ctx.fillStyle = Math.random() > 0.93 ? '#d9f4ff' : '#2dcfbc';
                ctx.fillText(bit, i * fontSize, drops[i] * fontSize);

                if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
                    drops[i] = 0;
                }
                drops[i] += 1;
            }

            window.requestAnimationFrame(draw);
        };

        draw();
    };

    const initRevealOnScroll = () => {
        const items = document.querySelectorAll('.reveal-on-scroll');
        if (!items.length) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            });
        }, {
            threshold: 0.18,
            rootMargin: '0px 0px -30px 0px'
        });

        items.forEach((item) => observer.observe(item));
    };

    setCurrentYear();
    initMobileMenu();
    initAuthAwareNav();
    initBinaryCanvas();
    initRevealOnScroll();
})();
