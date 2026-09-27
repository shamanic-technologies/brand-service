import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * A brand transfer must leave the source org holding NOTHING of the brand. The
 * move primitive re-keys every table carrying both `org_id` and `brand_id`; a
 * table added later that it does not know about would silently stay behind in
 * the source org. This guard fails the build until the new table is handled.
 */
const root = path.resolve(__dirname, '../..');
const schema = fs.readFileSync(path.join(root, 'src/db/schema.ts'), 'utf-8');
const service = fs.readFileSync(path.join(root, 'src/services/brandOrgMoveService.ts'), 'utf-8');

function orgAndBrandScopedTables(): string[] {
  const tables: string[] = [];
  const re = /pgTable\("(\w+)", \{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema))) {
    const body = m[2];
    if (body.includes('"org_id"') && body.includes('"brand_id"')) tables.push(m[1]);
  }
  return tables.sort();
}

function listedTables(): string[] {
  const block = service.slice(
    service.indexOf('export const ORG_SCOPED_BRAND_TABLES'),
    service.indexOf('] as const;', service.indexOf('export const ORG_SCOPED_BRAND_TABLES')),
  );
  return [...block.matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
}

describe('brandOrgMoveService covers every (org, brand) table', () => {
  it('ORG_SCOPED_BRAND_TABLES equals the tables in schema.ts carrying org_id AND brand_id', () => {
    const found = orgAndBrandScopedTables();
    expect(found.length).toBeGreaterThan(5);
    expect(listedTables()).toEqual(found);
  });

  it('the move writes every listed table', () => {
    const body = service.slice(service.indexOf('export async function moveBrandBetweenOrgs'));
    for (const table of listedTables()) {
      const oneRow = service.slice(service.indexOf('const ONE_ROW_PER_ORG_BRAND'), service.indexOf('async function count'));
      const handled = body.includes(`UPDATE ${table} `) || body.includes(`FROM ${table} `) || oneRow.includes(`'${table}'`);
      expect(handled, `${table} is not moved by moveBrandBetweenOrgs`).toBe(true);
    }
  });
});
