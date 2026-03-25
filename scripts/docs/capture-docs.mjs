import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startMockApiServer } from './mock-api-server.mjs';
import { startDocsHost } from './docs-host.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'scripts', 'docs', 'capture-manifest.json');
const MANIFEST = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf-8'));
const HOST_PORT = Number(process.env.DOCS_HOST_PORT || 4180);
const API_PORT = Number(process.env.DOCS_MOCK_API_PORT || 4181);
const BASE_URL = `http://127.0.0.1:${HOST_PORT}`;
const OUT_DIR = path.join(ROOT, MANIFEST.outputDir);
const FIXED_NOW = new Date(MANIFEST.fixedNow || '2026-03-25T08:00:00.000Z').valueOf();
const DOCS_MANIFEST_OUT = path.join(ROOT, 'frontend', 'docs', 'assets', 'screens', 'manifest.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getMaskLocators(page, selectors = []) {
  return selectors.filter(Boolean).map((selector) => page.locator(selector));
}

async function setupContext(context, screen) {
  await context.addInitScript(({ fixedNow, storage }) => {
    const RealDate = Date;
    function MockDate(...args) {
      if (this instanceof MockDate) {
        return args.length === 0 ? new RealDate(fixedNow) : new RealDate(...args);
      }
      return args.length === 0 ? new RealDate(fixedNow).toString() : new RealDate(...args).toString();
    }
    MockDate.now = () => fixedNow;
    MockDate.UTC = RealDate.UTC;
    MockDate.parse = RealDate.parse;
    MockDate.prototype = RealDate.prototype;
    window.Date = MockDate;

    Math.random = () => 0.42;

    class FakeWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        queueMicrotask(() => this.onopen?.({ type: 'open' }));
      }
      send() {}
      close() {
        this.readyState = 3;
        this.onclose?.({ type: 'close', code: 1000, reason: 'closed' });
      }
      addEventListener() {}
      removeEventListener() {}
    }
    window.WebSocket = FakeWebSocket;

    class FakeIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target) {
        this.callback([{ isIntersecting: true, target }], this);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    window.IntersectionObserver = FakeIntersectionObserver;

    for (const [key, value] of Object.entries(storage || {})) {
      localStorage.setItem(key, value);
    }
  }, { fixedNow: FIXED_NOW, storage: screen.storage || {} });
}

async function waitForSelectors(page, selectors = []) {
  for (const selector of selectors) {
    await page.waitForSelector(selector, { state: 'visible', timeout: 30000 });
  }
}

async function runActions(page, actions = []) {
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;

    if (action.type === 'click' && action.selector) {
      await page.click(action.selector, { timeout: 30000 });
      continue;
    }

    if (action.type === 'evaluate' && action.expression) {
      // eslint-disable-next-line no-new-func
      const fn = new Function(action.expression);
      await page.evaluate(fn);
    }
  }
}

async function applyPreState(page, screen) {
  if (screen.state === 'network-banner') {
    await page.route('**/api/workspaces**', (route) => route.abort());
  }
}

async function applyPostState(page, screen) {
  if (screen.state === 'dashboard-list') {
    await page.evaluate(() => window.showPanel?.('workspaces'));
  } else if (screen.state === 'network-banner') {
    await page.evaluate(() => {
      if (typeof window.setDashboardNetworkBanner === 'function') {
        window.setDashboardNetworkBanner(true, 'Simulated network outage for docs capture.');
      }
    });
  } else if (screen.state === 'workspace-editor') {
    await page.evaluate(() => {
      const label = document.getElementById('primarySaveButtonLabel');
      const button = document.getElementById('primarySaveButton');
      if (label) label.textContent = 'Save All (2)';
      if (button) button.title = 'Save all modified files (Ctrl+Shift+S)';
    });
  }
}

async function captureScreen(browser, screen) {
  const context = await browser.newContext({
    viewport: MANIFEST.viewport,
    deviceScaleFactor: MANIFEST.viewport.deviceScaleFactor || 1,
    locale: MANIFEST.locale || 'en-US',
    timezoneId: MANIFEST.timezoneId || 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  });

  await setupContext(context, screen);

  const page = await context.newPage();

  if (screen.state === 'unauthorized-redirect') {
    await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/login/, { timeout: 30000 });
    await waitForSelectors(page, screen.waitFor || []);
    await page.waitForFunction(
      () => window.location.search.includes('returnTo=%2Fworkspace%2Fws-alpha%2Feditor%2Fproj-main'),
      null,
      { timeout: 30000 }
    );
  } else {
    await applyPreState(page, screen);
    await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: 'domcontentloaded' });
    await runActions(page, screen.actions || []);
    await applyPostState(page, screen);
    await waitForSelectors(page, screen.waitFor || []);

    if (screen.state === 'dashboard-list') {
      await page.waitForFunction(
        () => {
          const list = document.getElementById('workspaceList');
          return list && list.children.length > 0;
        },
        null,
        { timeout: 30000 }
      );
    }

    if (screen.state === 'network-banner') {
      await page.waitForSelector('#networkStatusBanner.show', { state: 'visible', timeout: 30000 });
    }
  }

  await page.evaluate(() => document.fonts?.ready || Promise.resolve());
  await sleep(350);

  const mask = getMaskLocators(page, screen.mask || []);

  await page.screenshot({
    path: path.join(OUT_DIR, screen.file),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    mask,
    maskColor: '#0b1020'
  });

  await context.close();
}

async function writeDocsScreenshotManifest() {
  const screens = MANIFEST.screens.map((screen) => ({
    name: screen.name,
    group: screen.group || 'workspace',
    title: screen.title || screen.name,
    description: screen.description || '',
    file: `/docs/assets/screens/${screen.file}`,
    path: screen.path
  }));

  await fs.writeFile(
    DOCS_MANIFEST_OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: '/scripts/docs/capture-manifest.json',
        screens
      },
      null,
      2
    ),
    'utf-8'
  );
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const mockServer = await startMockApiServer(API_PORT);
  const docsServer = await startDocsHost(HOST_PORT);

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  };

  if (process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH;
  }

  const browser = await chromium.launch(launchOptions);

  try {
    for (const screen of MANIFEST.screens) {
      console.log(`Capturing ${screen.name} -> ${screen.file}`);
      await captureScreen(browser, screen);
    }

    await writeDocsScreenshotManifest();
    console.log(`Saved ${MANIFEST.screens.length} screenshots to ${OUT_DIR}`);
  } finally {
    await browser.close();
    await Promise.allSettled([
      new Promise((resolve) => mockServer.close(resolve)),
      new Promise((resolve) => docsServer.close(resolve))
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});