import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('OpenAPI Spec', () => {
  const specPath = path.join(__dirname, '../../openapi.json');

  it('should have a generated openapi.json file', () => {
    expect(fs.existsSync(specPath), 'openapi.json should exist - run pnpm generate:openapi').toBe(true);
  });

  it('should be valid OpenAPI 3.0.0', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    expect(spec.openapi).toBe('3.0.0');
  });

  it('should have correct service info', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    expect(spec.info.title).toBe('Brand Service API');
    expect(spec.info.version).toBe('1.0.0');
  });

  it('should include security definitions', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    expect(spec.components?.securitySchemes?.apiKey).toBeDefined();
    expect(spec.components.securitySchemes.apiKey.type).toBe('apiKey');
    expect(spec.components.securitySchemes.apiKey.in).toBe('header');
    expect(spec.components.securitySchemes.apiKey.name).toBe('X-API-Key');
  });

  it('should contain service endpoints', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    const paths = Object.keys(spec.paths);
    expect(paths).toContain('/health');
    expect(paths).toContain('/openapi.json');
    expect(paths.length).toBeGreaterThan(10);
  });

  it('should have zod-to-openapi component schemas', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    const schemas = Object.keys(spec.components?.schemas || {});
    expect(schemas.length).toBeGreaterThan(10);
    expect(schemas).toContain('CreateSalesProfileRequest');
    expect(schemas).toContain('ListBrandsResponse');
  });

  it('should have request body schemas on POST endpoints', () => {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
    const salesProfilePost = spec.paths['/sales-profile']?.post;
    expect(salesProfilePost?.requestBody?.content?.['application/json']?.schema).toBeDefined();
  });

  it('should be gitignored', () => {
    const gitignore = fs.readFileSync(path.join(__dirname, '../../.gitignore'), 'utf-8');
    expect(gitignore).toContain('openapi.json');
  });
});
