import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * These tests ensure we don't have stale/legacy code that could cause production crashes.
 * Context: brand-service crashed because stale dist/db.js was importing 'pg' after we
 * migrated to 'postgres' (postgres.js). This test catches similar issues early.
 */
describe('No Legacy Imports - CRITICAL', () => {
  const srcDir = path.join(__dirname, '../../src');
  
  function getAllTsFiles(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllTsFiles(fullPath));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('should NOT import "pg" module (we use postgres.js now)', () => {
    const files = getAllTsFiles(srcDir);
    const violations: string[] = [];
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      // Check for: import ... from 'pg' or require('pg')
      if (/from\s+['"]pg['"]/.test(content) || /require\s*\(\s*['"]pg['"]\s*\)/.test(content)) {
        violations.push(file);
      }
    }
    
    expect(violations, `Files importing deprecated 'pg' module: ${violations.join(', ')}`).toHaveLength(0);
  });

  it('should NOT use COMPANY_SERVICE_DATABASE_URL (renamed to BRAND_SERVICE_DATABASE_URL)', () => {
    const files = getAllTsFiles(srcDir);
    const violations: string[] = [];
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('COMPANY_SERVICE_DATABASE_URL')) {
        violations.push(file);
      }
    }
    
    expect(violations, `Files using deprecated COMPANY_SERVICE_DATABASE_URL: ${violations.join(', ')}`).toHaveLength(0);
  });

  it('should NOT have db.ts at src root (should be src/db/index.ts)', () => {
    const rootDbFile = path.join(srcDir, 'db.ts');
    expect(fs.existsSync(rootDbFile), 'src/db.ts should not exist - use src/db/index.ts instead').toBe(false);
  });

  it('should NOT have legacy pool export from pg in db/utils.ts', () => {
    const utilsFile = path.join(srcDir, 'db/utils.ts');
    if (fs.existsSync(utilsFile)) {
      const content = fs.readFileSync(utilsFile, 'utf-8');
      expect(content).not.toContain("from 'pg'");
      expect(content).not.toContain('require("pg")');
    }
  });
});

describe('Build Artifacts - CRITICAL', () => {
  const distDir = path.join(__dirname, '../../dist');
  
  it('should NOT have stale dist/db.js at root (should be dist/db/index.js)', () => {
    const staleDbFile = path.join(distDir, 'db.js');
    if (fs.existsSync(staleDbFile)) {
      const content = fs.readFileSync(staleDbFile, 'utf-8');
      // If the file exists and imports 'pg', it's definitely stale
      expect(content, 'Stale dist/db.js importing pg found - run rm -rf dist && pnpm build').not.toContain("require(\"pg\")");
    }
  });

  it('should have dist/db/index.js (correct structure)', () => {
    const correctDbFile = path.join(distDir, 'db/index.js');
    // This test only runs if dist exists (i.e., after build)
    if (fs.existsSync(distDir)) {
      expect(fs.existsSync(correctDbFile), 'dist/db/index.js should exist').toBe(true);
    }
  });
});
