import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('brand_sales_profiles removal', () => {
  it('should not export brandSalesProfiles from db schema', () => {
    const schemaContent = fs.readFileSync(
      path.resolve(__dirname, '../../src/db/schema.ts'),
      'utf-8',
    );
    expect(schemaContent).not.toContain('brandSalesProfiles');
    expect(schemaContent).not.toContain('brand_sales_profiles');
  });

  it('should have a migration to drop brand_sales_profiles', () => {
    const migrationPath = path.resolve(__dirname, '../../drizzle/0018_drop_brand_sales_profiles.sql');
    expect(fs.existsSync(migrationPath)).toBe(true);
    const content = fs.readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('DROP TABLE');
    expect(content).toContain('brand_sales_profiles');
  });

  it('should not reference brandSalesProfiles in drizzle relations', () => {
    const relationsContent = fs.readFileSync(
      path.resolve(__dirname, '../../drizzle/relations.ts'),
      'utf-8',
    );
    expect(relationsContent).not.toContain('brandSalesProfiles');
  });
});
