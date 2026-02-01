import { describe, it, expect } from 'vitest';

describe('Intake Form Logic', () => {
  describe('Form status transitions', () => {
    type FormStatus = 'pending' | 'generating' | 'completed' | 'failed';

    const isValidTransition = (from: FormStatus, to: FormStatus): boolean => {
      const validTransitions: Record<FormStatus, FormStatus[]> = {
        pending: ['generating'],
        generating: ['completed', 'failed'],
        completed: ['generating'], // Can regenerate
        failed: ['generating'], // Can retry
      };
      return validTransitions[from]?.includes(to) || false;
    };

    it('should allow pending -> generating', () => {
      expect(isValidTransition('pending', 'generating')).toBe(true);
    });

    it('should allow generating -> completed', () => {
      expect(isValidTransition('generating', 'completed')).toBe(true);
    });

    it('should allow generating -> failed', () => {
      expect(isValidTransition('generating', 'failed')).toBe(true);
    });

    it('should allow completed -> generating (regenerate)', () => {
      expect(isValidTransition('completed', 'generating')).toBe(true);
    });

    it('should allow failed -> generating (retry)', () => {
      expect(isValidTransition('failed', 'generating')).toBe(true);
    });

    it('should not allow pending -> completed', () => {
      expect(isValidTransition('pending', 'completed')).toBe(false);
    });

    it('should not allow completed -> failed', () => {
      expect(isValidTransition('completed', 'failed')).toBe(false);
    });
  });

  describe('Form data validation', () => {
    interface IntakeFormData {
      clerk_organization_id: string;
      company_name?: string;
      industry?: string;
      target_audience?: string;
      key_messages?: string[];
    }

    const validateFormData = (data: Partial<IntakeFormData>): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];

      if (!data.clerk_organization_id) {
        errors.push('clerk_organization_id is required');
      }

      if (data.company_name && data.company_name.length > 255) {
        errors.push('company_name must be 255 characters or less');
      }

      if (data.key_messages && !Array.isArray(data.key_messages)) {
        errors.push('key_messages must be an array');
      }

      return { valid: errors.length === 0, errors };
    };

    it('should require clerk_organization_id', () => {
      const result = validateFormData({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('clerk_organization_id is required');
    });

    it('should accept valid data', () => {
      const result = validateFormData({
        clerk_organization_id: 'org_123',
        company_name: 'Test Company',
        industry: 'Technology',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject too long company_name', () => {
      const result = validateFormData({
        clerk_organization_id: 'org_123',
        company_name: 'x'.repeat(300),
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('company_name must be 255 characters or less');
    });
  });

  describe('Form upsert logic', () => {
    it('should merge existing data with new data', () => {
      const existingData = {
        company_name: 'Old Name',
        industry: 'Tech',
        target_audience: 'Developers',
      };

      const newData = {
        company_name: 'New Name',
        key_messages: ['Message 1'],
      };

      const merged = { ...existingData, ...newData };

      expect(merged.company_name).toBe('New Name');
      expect(merged.industry).toBe('Tech'); // Preserved
      expect(merged.target_audience).toBe('Developers'); // Preserved
      expect(merged.key_messages).toEqual(['Message 1']); // Added
    });

    it('should handle null values correctly', () => {
      const existingData = {
        company_name: 'Name',
        industry: 'Tech',
      };

      const newData = {
        industry: null as any,
      };

      const merged = { ...existingData, ...newData };

      expect(merged.industry).toBeNull();
      expect(merged.company_name).toBe('Name');
    });
  });

  describe('Webhook payload structure', () => {
    it('should create correct n8n webhook payload', () => {
      const signature = 'secret-123';
      const externalOrganizationId = 'ext-org-456';

      const payload = [
        {
          signature,
          external_organization_id: externalOrganizationId,
        },
      ];

      expect(Array.isArray(payload)).toBe(true);
      expect(payload).toHaveLength(1);
      expect(payload[0].signature).toBe(signature);
      expect(payload[0].external_organization_id).toBe(externalOrganizationId);
    });
  });
});
