import { describe, it, expect } from 'vitest';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../src/db/schema';

/**
 * Every explicit index operator class must match its column's type.
 *
 * `schema.ts` carries operator classes that were INTROSPECTED out of a live
 * database, and one pair had been recorded against the wrong columns: the uuid
 * column tagged `bool_ops`, the boolean column tagged `uuid_ops`. It survived
 * for as long as it did because `drizzle-kit push` only ever ran against a
 * database that already had that index, so Postgres was never asked to create
 * it. The moment CI began building the schema from an EMPTY database it failed
 * with `operator class "bool_ops" does not accept data type uuid` — and
 * drizzle-kit reports that and exits 0, abandoning every statement after it, so
 * the suite would have run against a half-built schema.
 *
 * CI now fails loudly on that, but the mismatch is cheaper to catch here, with
 * no database at all.
 */
const OPS_FOR_TYPE: Record<string, string[]> = {
  'PgUUID': ['uuid_ops'],
  'PgBoolean': ['bool_ops'],
  'PgText': ['text_ops', 'varchar_ops'],
  'PgVarchar': ['text_ops', 'varchar_ops'],
  'PgInteger': ['int4_ops'],
  'PgSerial': ['int4_ops'],
  'PgBigInt53': ['int8_ops'],
  'PgJsonb': ['jsonb_ops', 'jsonb_path_ops'],
  'PgJson': ['json_ops'],
  'PgTimestampString': ['timestamptz_ops', 'timestamp_ops'],
  'PgDateString': ['date_ops'],
};

describe('schema.ts index operator classes', () => {
  it('every explicit opclass matches the type of the column it is on', () => {
    const mismatches: string[] = [];

    for (const [exportName, value] of Object.entries(schema)) {
      // Only pgTable exports carry indexes; views/enums/helpers do not.
      let config: ReturnType<typeof getTableConfig>;
      try {
        config = getTableConfig(value as PgTable);
      } catch {
        continue;
      }

      for (const index of config.indexes) {
        for (const column of index.config.columns) {
          // `opClass` is only set where schema.ts spells one out; a plain
          // `.on(col)` leaves Postgres to pick the default and cannot mismatch.
          const opClass = (column as { indexConfig?: { opClass?: string } })
            .indexConfig?.opClass;
          if (!opClass) continue;

          // Drizzle exposes the column's kind as `type` on an index column
          // (`PgUUID`, `PgBoolean`, …) — NOT as `columnType`, which is
          // undefined here and would make this guard silently inspect nothing.
          const columnType = (column as { type?: string }).type;
          const allowed = columnType ? OPS_FOR_TYPE[columnType] : undefined;
          // An unmapped column type is not a failure — this guard only knows
          // about the types the schema actually indexes today.
          if (!allowed) continue;

          if (!allowed.includes(opClass)) {
            const name = (column as { name?: string }).name;
            mismatches.push(
              `${exportName}.${index.config.name ?? '(unnamed)'}: column "${name}" is ${columnType} but tagged "${opClass}" (expected one of ${allowed.join(', ')})`
            );
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
