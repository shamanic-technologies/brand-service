import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { brandExtractedFields } from '../../src/db/schema';

/**
 * Regression test for: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
 *
 * The upsert in fieldExtractionService requires two partial unique indexes on brand_extracted_fields,
 * each keyed by (brand_id, field_key, field_description_hash) so that the same field_key with
 * different prompt descriptions resolves to different cache rows:
 * 1. WHERE campaign_id IS NULL — for non-campaign extractions
 * 2. WHERE campaign_id IS NOT NULL — for campaign-scoped extractions (campaign_id appended)
 *
 * Without these indexes, every extract-fields call fails with error code 42P10.
 */
describe('brand_extracted_fields upsert indexes', () => {
  const config = getTableConfig(brandExtractedFields);

  it('should have a partial unique index on (brand_id, field_key, field_description_hash) WHERE campaign_id IS NULL', () => {
    const idx = config.indexes.find(i => i.config.name === 'idx_extracted_fields_brand_key_desc_no_campaign');
    expect(idx, 'Missing unique index idx_extracted_fields_brand_key_desc_no_campaign').toBeDefined();
    expect(idx!.config.unique, 'Index must be unique').toBe(true);

    const columnNames = idx!.config.columns
      .filter((c): c is { name: string } => 'name' in c)
      .map(c => c.name);
    expect(columnNames).toEqual(['brand_id', 'field_key', 'field_description_hash']);
  });

  it('should have a partial unique index on (brand_id, field_key, field_description_hash, campaign_id) WHERE campaign_id IS NOT NULL', () => {
    const idx = config.indexes.find(i => i.config.name === 'idx_extracted_fields_brand_key_desc_campaign');
    expect(idx, 'Missing unique index idx_extracted_fields_brand_key_desc_campaign').toBeDefined();
    expect(idx!.config.unique, 'Index must be unique').toBe(true);

    const columnNames = idx!.config.columns
      .filter((c): c is { name: string } => 'name' in c)
      .map(c => c.name);
    expect(columnNames).toEqual(['brand_id', 'field_key', 'field_description_hash', 'campaign_id']);
  });
});
