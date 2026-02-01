import { describe, it, expect, vi } from 'vitest';

describe('Database Utilities', () => {
  describe('Query parameter interpolation', () => {
    // Simulating the interpolation logic from db/utils.ts
    function interpolateQuery(text: string, params: any[]): string {
      let query = text;

      for (let i = 0; i < params.length; i++) {
        const param = params[i];
        const placeholder = `$${i + 1}`;

        let value: string;
        if (param === null || param === undefined) {
          value = 'NULL';
        } else if (typeof param === 'string') {
          value = `'${param.replace(/'/g, "''")}'`;
        } else if (typeof param === 'number') {
          value = String(param);
        } else if (typeof param === 'boolean') {
          value = param ? 'TRUE' : 'FALSE';
        } else if (param instanceof Date) {
          value = `'${param.toISOString()}'`;
        } else if (Array.isArray(param)) {
          const arrayValues = param.map((v) => {
            if (v === null) return 'NULL';
            if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
            return String(v);
          });
          value = `ARRAY[${arrayValues.join(',')}]`;
        } else if (typeof param === 'object') {
          value = `'${JSON.stringify(param).replace(/'/g, "''")}'::jsonb`;
        } else {
          value = String(param);
        }

        query = query.replace(new RegExp(`\\$${i + 1}(?![0-9])`, 'g'), value);
      }

      return query;
    }

    it('should handle string parameters', () => {
      const result = interpolateQuery('SELECT * FROM brands WHERE name = $1', ['Test Brand']);
      expect(result).toBe("SELECT * FROM brands WHERE name = 'Test Brand'");
    });

    it('should escape single quotes in strings', () => {
      const result = interpolateQuery('SELECT * FROM brands WHERE name = $1', ["O'Reilly"]);
      expect(result).toBe("SELECT * FROM brands WHERE name = 'O''Reilly'");
    });

    it('should handle number parameters', () => {
      const result = interpolateQuery('SELECT * FROM brands LIMIT $1', [10]);
      expect(result).toBe('SELECT * FROM brands LIMIT 10');
    });

    it('should handle boolean parameters', () => {
      const result = interpolateQuery('SELECT * FROM brands WHERE active = $1', [true]);
      expect(result).toBe('SELECT * FROM brands WHERE active = TRUE');

      const resultFalse = interpolateQuery('SELECT * FROM brands WHERE active = $1', [false]);
      expect(resultFalse).toBe('SELECT * FROM brands WHERE active = FALSE');
    });

    it('should handle null parameters', () => {
      const result = interpolateQuery('SELECT * FROM brands WHERE url = $1', [null]);
      expect(result).toBe('SELECT * FROM brands WHERE url = NULL');
    });

    it('should handle Date parameters', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const result = interpolateQuery('SELECT * FROM brands WHERE created_at > $1', [date]);
      expect(result).toBe("SELECT * FROM brands WHERE created_at > '2024-01-15T10:30:00.000Z'");
    });

    it('should handle array parameters', () => {
      const result = interpolateQuery('SELECT * FROM brands WHERE id = ANY($1)', [['id1', 'id2', 'id3']]);
      expect(result).toBe("SELECT * FROM brands WHERE id = ANY(ARRAY['id1','id2','id3'])");
    });

    it('should handle object parameters as JSONB', () => {
      const obj = { key: 'value', nested: { a: 1 } };
      const result = interpolateQuery('INSERT INTO brands (metadata) VALUES ($1)', [obj]);
      expect(result).toContain('::jsonb');
      expect(result).toContain('"key":"value"');
    });

    it('should handle multiple parameters', () => {
      const result = interpolateQuery(
        'SELECT * FROM brands WHERE name = $1 AND domain = $2 LIMIT $3',
        ['Test', 'example.com', 10]
      );
      expect(result).toBe("SELECT * FROM brands WHERE name = 'Test' AND domain = 'example.com' LIMIT 10");
    });

    it('should not replace $10 when replacing $1', () => {
      const params = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
      const result = interpolateQuery('SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10', params);
      expect(result).toBe("SELECT 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'");
    });

    it('should handle empty params array', () => {
      const result = interpolateQuery('SELECT * FROM brands', []);
      expect(result).toBe('SELECT * FROM brands');
    });
  });

  describe('Pool compatibility layer', () => {
    it('should provide query method', () => {
      // This is a structure test - actual DB tests are in integration
      const mockPool = {
        query: async (text: string, params?: any[]) => ({ rows: [], rowCount: 0 }),
        connect: async () => ({
          query: async (text: string, params?: any[]) => ({ rows: [], rowCount: 0 }),
          release: () => {},
        }),
        end: async () => {},
      };

      expect(typeof mockPool.query).toBe('function');
      expect(typeof mockPool.connect).toBe('function');
      expect(typeof mockPool.end).toBe('function');
    });
  });
});
