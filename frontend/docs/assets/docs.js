(function () {
  const navLinks = [
    { href: '/docs', title: 'Overview', section: 'Foundation' },
    { href: '/docs/getting-started', title: 'Getting Started', section: 'Foundation' },
    { href: '/docs/architecture', title: 'Architecture', section: 'Foundation' },
    { href: '/docs/web-ui', title: 'Web UI Guide', section: 'Product' },
    { href: '/docs/api', title: 'API Reference', section: 'API' },
    { href: '/docs/api/websocket', title: 'WebSocket Appendix', section: 'API' },
    { href: '/docs/errors', title: 'Error Catalog', section: 'API' },
    { href: '/docs/changelog', title: 'Changelog', section: 'Maintenance' }
  ];

  const searchInput = document.getElementById('docsSearch');
  const results = document.getElementById('searchResults');

  function normalizePath(path) {
    if (!path) return '/';
    let value = String(path).split('#')[0].split('?')[0];
    if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
    return value || '/';
  }

  function activeHref(pathname) {
    const current = normalizePath(pathname);
    let best = '/docs';
    let bestLength = 0;
    for (const item of navLinks) {
      const target = normalizePath(item.href);
      if (current === target || current.startsWith(`${target}/`)) {
        if (target.length > bestLength) {
          best = item.href;
          bestLength = target.length;
        }
      }
    }
    return best;
  }

  function buildSidebar() {
    const nav = document.getElementById('docsNav');
    if (!nav) return;

    const grouped = new Map();
    for (const item of navLinks) {
      if (!grouped.has(item.section)) grouped.set(item.section, []);
      grouped.get(item.section).push(item);
    }

    const active = activeHref(window.location.pathname);
    nav.innerHTML = '';

    for (const [section, items] of grouped.entries()) {
      const title = document.createElement('p');
      title.className = 'docs-nav-title';
      title.textContent = section;
      nav.appendChild(title);

      for (const item of items) {
        const link = document.createElement('a');
        link.href = item.href;
        link.textContent = item.title;
        if (item.href === active) link.classList.add('active');
        nav.appendChild(link);
      }
    }
  }

  function hideResults() {
    if (!results) return;
    results.style.display = 'none';
    results.innerHTML = '';
  }

  function showSearch(query) {
    if (!results) return;
    const value = String(query || '').trim().toLowerCase();
    if (!value) {
      hideResults();
      return;
    }

    const hits = navLinks.filter((item) => `${item.title} ${item.section}`.toLowerCase().includes(value));
    results.innerHTML = '';

    if (!hits.length) {
      const none = document.createElement('p');
      none.className = 'search-empty';
      none.textContent = `No results for "${query}".`;
      results.appendChild(none);
      results.style.display = 'block';
      return;
    }

    for (const hit of hits) {
      const link = document.createElement('a');
      link.href = hit.href;
      link.textContent = `${hit.title} (${hit.section})`;
      results.appendChild(link);
    }

    results.style.display = 'block';
  }

  async function renderScreenshotGalleries() {
    const galleries = document.querySelectorAll('[data-screenshot-gallery]');
    if (!galleries.length) return;

    let manifest = null;
    try {
      const response = await fetch('/docs/assets/screens/manifest.json', { cache: 'no-store' });
      if (response.ok) manifest = await response.json();
    } catch {
      manifest = null;
    }

    galleries.forEach((host) => {
      const category = host.getAttribute('data-screenshot-gallery') || 'all';
      const items = Array.isArray(manifest?.screens) ? manifest.screens : [];
      const filtered = category === 'all' ? items : items.filter((item) => item.group === category);

      if (!filtered.length) {
        host.innerHTML = '<p class="callout warn">Screenshots are not generated yet. Run <code>npm run docs:capture</code>.</p>';
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'screenshot-grid';

      for (const shot of filtered) {
        const figure = document.createElement('figure');
        figure.className = 'screenshot-card';
        figure.innerHTML = `
          <img src="${shot.file}" alt="${shot.title}">
          <figcaption><strong>${shot.title}</strong><br>${shot.description || ''}</figcaption>
        `;
        grid.appendChild(figure);
      }

      host.innerHTML = '';
      host.appendChild(grid);
    });
  }

  function bindSearch() {
    if (!searchInput) return;
    searchInput.addEventListener('input', () => showSearch(searchInput.value));
    searchInput.addEventListener('focus', () => showSearch(searchInput.value));
    document.addEventListener('click', (event) => {
      if (!results || !searchInput) return;
      if (event.target === searchInput || results.contains(event.target)) return;
      hideResults();
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        searchInput.blur();
        hideResults();
      }
    });
  }

  function fillGeneratedAt() {
    const nodes = document.querySelectorAll('[data-docs-generated-at]');
    if (!nodes.length) return;
    const now = new Date();
    const text = now.toISOString().slice(0, 10);
    nodes.forEach((node) => {
      node.textContent = text;
    });
  }

  function init() {
    buildSidebar();
    bindSearch();
    fillGeneratedAt();
    renderScreenshotGalleries();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();