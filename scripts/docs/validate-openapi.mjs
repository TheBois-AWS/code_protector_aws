import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import SwaggerParser from '@apidevtools/swagger-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..', '..');
const openApiPath = join(rootDir, 'frontend', 'docs', 'openapi.yaml');

try {
  await SwaggerParser.validate(openApiPath);
  console.log(`OpenAPI document is valid: ${openApiPath}`);
} catch (error) {
  console.error('OpenAPI validation failed.');
  console.error(error?.message || error);
  process.exitCode = 1;
}
