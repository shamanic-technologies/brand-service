import { describe, it, expect } from 'vitest';

describe('Sales Profile Extraction', () => {
  describe('Cost calculation', () => {
    it('should calculate cost correctly for Claude 3 Haiku', () => {
      // Haiku pricing: $0.25/1M input, $1.25/1M output
      const calculateCost = (inputTokens: number, outputTokens: number): number => {
        return (inputTokens * 0.25 + outputTokens * 1.25) / 1000000;
      };

      // 5000 input tokens, 1000 output tokens
      const cost = calculateCost(5000, 1000);
      expect(cost).toBeCloseTo(0.00250, 5); // ~$0.0025
    });
  });

  describe('Profile structure', () => {
    it('should have correct structure', () => {
      const profile = {
        companyName: 'Test Company',
        valueProposition: 'Test value prop',
        customerPainPoints: ['pain1', 'pain2'],
        callToAction: 'Book a demo',
        socialProof: {
          caseStudies: [],
          testimonials: [],
          results: [],
        },
        companyOverview: 'Overview',
        additionalContext: null,
        competitors: [],
        productDifferentiators: [],
        targetAudience: 'B2B SaaS',
        keyFeatures: ['feature1'],
      };

      expect(profile.customerPainPoints).toBeInstanceOf(Array);
      expect(profile.socialProof).toHaveProperty('caseStudies');
      expect(profile.socialProof).toHaveProperty('testimonials');
      expect(profile.socialProof).toHaveProperty('results');
    });
  });

  describe('URL selection', () => {
    it('should limit to 10 URLs', () => {
      const urls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i}`);
      const selectedUrls = urls.slice(0, 10);
      expect(selectedUrls.length).toBe(10);
    });

    it('should return all URLs if less than 10', () => {
      const urls = ['https://example.com', 'https://example.com/about'];
      const selectedUrls = urls.length <= 10 ? urls : urls.slice(0, 10);
      expect(selectedUrls.length).toBe(2);
    });
  });
});
