import { readFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import SwaggerParser from '@apidevtools/swagger-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');
const routerPath = join(rootDir, 'src', 'router.js');
const openApiPath = join(rootDir, 'frontend', 'docs', 'openapi.yaml');
const httpMethods = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);

function normalizeRoutePath(value) {
  return String(value).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function collectRoutes(source) {
  const routePattern = /\{\s*method:\s*'([^']+)'\s*,\s*path:\s*'([^']+)'\s*,/g;
  const routes = [];
  let match = routePattern.exec(source);
  while (match) {
    routes.push({
      method: String(match[1]).toUpperCase(),
      path: normalizeRoutePath(match[2])
    });
    match = routePattern.exec(source);
  }
  return routes;
}

function collectOpenApiOperations(spec) {
  const operations = [];
  for (const [pathKey, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!httpMethods.has(method)) continue;
      if (!operation || typeof operation !== 'object') continue;
      operations.push({
        method: method.toUpperCase(),
        path: pathKey
      });
    }
  }
  return operations;
}

function formatList(items, title) {
  if (!items.length) return '';
  const lines = [title];
  for (const item of items) lines.push(`  ${item.method} ${item.path}`);
  return lines.join('\n');
}

const [routerSource, spec] = await Promise.all([
  readFile(routerPath, 'utf8'),
  SwaggerParser.parse(openApiPath)
]);

const routerRoutes = collectRoutes(routerSource);
const openApiRoutes = collectOpenApiOperations(spec);

const routerSet = new Set(routerRoutes.map((item) => `${item.method} ${item.path}`));
const openApiSet = new Set(openApiRoutes.map((item) => `${item.method} ${item.path}`));

const missing = routerRoutes.filter((item) => !openApiSet.has(`${item.method} ${item.path}`));
const extra = openApiRoutes.filter((item) => !routerSet.has(`${item.method} ${item.path}`));

if (missing.length || extra.length) {
  console.error('OpenAPI parity check failed.');
  const missingText = formatList(missing, 'Missing methods in OpenAPI:');
  const extraText = formatList(extra, 'Extra methods in OpenAPI:');
  if (missingText) console.error(missingText);
  if (extraText) console.error(extraText);
  process.exitCode = 1;
} else {
  console.log(`OpenAPI parity check passed (${routerRoutes.length} routes).`);
}
