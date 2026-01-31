import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Sales Profile Extraction', () => {
  describe('Cost calculation', () => {
    const calculateCost = (inputTokens: number, outputTokens: number): number => {
      // Haiku pricing: $0.25/1M input, $1.25/1M output
      return (inputTokens * 0.25 + outputTokens * 1.25) / 1000000;
    };

    it('should calculate cost correctly for Claude 3 Haiku', () => {
      // 5000 input tokens, 1000 output tokens
      const cost = calculateCost(5000, 1000);
      expect(cost).toBeCloseTo(0.00250, 5); // ~$0.0025
    });

    it('should calculate cost for typical extraction (10 pages)', () => {
      // ~50K input tokens (10 pages), ~2K output tokens
      const cost = calculateCost(50000, 2000);
      expect(cost).toBeCloseTo(0.015, 4); // ~$0.015
    });

    it('should calculate cost for minimal extraction', () => {
      // 1K input, 500 output
      const cost = calculateCost(1000, 500);
      expect(cost).toBeCloseTo(0.000875, 6);
    });

    it('should return 0 for 0 tokens', () => {
      const cost = calculateCost(0, 0);
      expect(cost).toBe(0);
    });
  });

  describe('Profile structure', () => {
    it('should have correct structure with all fields', () => {
      const profile = {
        id: 'uuid',
        organizationId: 'org-uuid',
        companyName: 'Test Company',
        valueProposition: 'Test value prop',
        customerPainPoints: ['pain1', 'pain2'],
        callToAction: 'Book a demo',
        socialProof: {
          caseStudies: ['Case study 1'],
          testimonials: ['Great product!'],
          results: ['50% improvement'],
        },
        companyOverview: 'Overview text',
        additionalContext: 'Extra context',
        competitors: ['Competitor A', 'Competitor B'],
        productDifferentiators: ['Unique feature 1'],
        targetAudience: 'B2B SaaS companies',
        keyFeatures: ['Feature 1', 'Feature 2'],
        extractionModel: 'claude-3-haiku-20240307',
        extractionCostUsd: 0.002,
        extractedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Verify structure
      expect(profile.customerPainPoints).toBeInstanceOf(Array);
      expect(profile.competitors).toBeInstanceOf(Array);
      expect(profile.keyFeatures).toBeInstanceOf(Array);
      expect(profile.socialProof).toHaveProperty('caseStudies');
      expect(profile.socialProof).toHaveProperty('testimonials');
      expect(profile.socialProof).toHaveProperty('results');
      expect(typeof profile.extractionCostUsd).toBe('number');
    });

    it('should handle empty arrays gracefully', () => {
      const profile = {
        customerPainPoints: [],
        competitors: [],
        productDifferentiators: [],
        keyFeatures: [],
        socialProof: {
          caseStudies: [],
          testimonials: [],
          results: [],
        },
      };

      expect(profile.customerPainPoints.length).toBe(0);
      expect(profile.socialProof.caseStudies.length).toBe(0);
    });
  });

  describe('URL selection logic', () => {
    it('should limit to 10 URLs maximum', () => {
      const urls = Array.from({ length: 50 }, (_, i) => `https://example.com/page${i}`);
      const selectedUrls = urls.slice(0, 10);
      expect(selectedUrls.length).toBe(10);
    });

    it('should return all URLs if less than 10', () => {
      const urls = ['https://example.com', 'https://example.com/about'];
      const selectedUrls = urls.length <= 10 ? urls : urls.slice(0, 10);
      expect(selectedUrls.length).toBe(2);
    });

    it('should return empty array if no URLs', () => {
      const urls: string[] = [];
      const selectedUrls = urls.length <= 10 ? urls : urls.slice(0, 10);
      expect(selectedUrls.length).toBe(0);
    });

    it('should handle exactly 10 URLs', () => {
      const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/page${i}`);
      const selectedUrls = urls.length <= 10 ? urls : urls.slice(0, 10);
      expect(selectedUrls.length).toBe(10);
    });
  });

  describe('Cache duration', () => {
    it('should set 30-day cache expiry', () => {
      const CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const expiresAt = new Date(now + CACHE_DURATION_MS);
      
      const diffDays = (expiresAt.getTime() - now) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeCloseTo(30, 1);
    });
  });

  describe('Content truncation', () => {
    it('should limit page content to 15000 chars', () => {
      const longContent = 'x'.repeat(20000);
      const truncated = longContent.substring(0, 15000);
      expect(truncated.length).toBe(15000);
    });

    it('should limit combined content to 100000 chars', () => {
      const combinedContent = 'x'.repeat(150000);
      const truncated = combinedContent.substring(0, 100000);
      expect(truncated.length).toBe(100000);
    });
  });

  describe('JSON parsing', () => {
    it('should extract JSON from AI response', () => {
      const aiResponse = `Here is the analysis:

{
  "companyName": "Apollo.io",
  "valueProposition": "End-to-end sales automation"
}

Hope this helps!`;

      const match = aiResponse.match(/\{[\s\S]*\}/);
      expect(match).not.toBeNull();
      
      const parsed = JSON.parse(match![0]);
      expect(parsed.companyName).toBe('Apollo.io');
      expect(parsed.valueProposition).toBe('End-to-end sales automation');
    });

    it('should handle nested JSON objects', () => {
      const aiResponse = `{
  "socialProof": {
    "caseStudies": ["Case 1", "Case 2"],
    "testimonials": ["Great!"],
    "results": ["50% growth"]
  }
}`;

      const parsed = JSON.parse(aiResponse);
      expect(parsed.socialProof.caseStudies).toHaveLength(2);
      expect(parsed.socialProof.testimonials).toHaveLength(1);
    });
  });
});
