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

  describe('New fields — leadership, funding, awards, revenueMilestones', () => {
    it('should include new fields in profile structure', () => {
      const profile = {
        leadership: [{ name: 'Jane Smith', role: 'CEO', bio: 'Experienced leader', notableBackground: 'Former Google VP' }],
        funding: {
          totalRaised: '$10M',
          rounds: [{ type: 'Series A', amount: '$10M', date: '2023', notableInvestors: ['Sequoia'] }],
          notableBackers: ['Y Combinator'],
        },
        awardsAndRecognition: [{ title: 'Best SaaS 2023', issuer: 'G2', year: '2023', description: null }],
        revenueMilestones: [{ metric: 'ARR', value: '$5M', date: '2023', context: null }],
      };

      expect(profile.leadership).toHaveLength(1);
      expect(profile.leadership[0].name).toBe('Jane Smith');
      expect(profile.funding.totalRaised).toBe('$10M');
      expect(profile.funding.notableBackers).toContain('Y Combinator');
      expect(profile.awardsAndRecognition).toHaveLength(1);
      expect(profile.revenueMilestones[0].metric).toBe('ARR');
    });

    it('should default new fields to empty arrays and null when absent from LLM response', () => {
      const parsed: Record<string, unknown> = {};
      const leadership = (parsed.leadership as unknown[]) || [];
      const funding = parsed.funding || null;
      const awardsAndRecognition = (parsed.awardsAndRecognition as unknown[]) || [];
      const revenueMilestones = (parsed.revenueMilestones as unknown[]) || [];

      expect(leadership).toEqual([]);
      expect(funding).toBeNull();
      expect(awardsAndRecognition).toEqual([]);
      expect(revenueMilestones).toEqual([]);
    });

    it('should handle rich testimonial objects', () => {
      const testimonials = [
        { quote: 'Amazing product', name: 'Jane', role: 'CTO', company: 'Acme' },
        { quote: 'Saved us hours', name: null, role: null, company: null },
      ];

      expect(testimonials[0].quote).toBe('Amazing product');
      expect(testimonials[0].name).toBe('Jane');
      expect(testimonials[1].name).toBeNull();
    });

    it('should support mixed legacy string and rich testimonials', () => {
      const testimonials: (string | { quote: string; name: string | null; role: string | null; company: string | null })[] = [
        'Legacy string testimonial',
        { quote: 'Rich testimonial', name: 'Bob', role: 'VP Sales', company: 'Corp' },
      ];

      expect(typeof testimonials[0]).toBe('string');
      expect(typeof testimonials[1]).toBe('object');
      expect((testimonials[1] as { quote: string }).quote).toBe('Rich testimonial');
    });

    it('should parse new fields from AI JSON response', () => {
      const aiResponse = `{
  "brandName": "TestCo",
  "valueProposition": "Best product",
  "leadership": [{"name": "Alice", "role": "CEO", "bio": "Founded in 2020", "notableBackground": null}],
  "funding": {"totalRaised": "$5M", "rounds": [], "notableBackers": ["YC"]},
  "awardsAndRecognition": [{"title": "Top 50 Startups", "issuer": "Forbes", "year": "2024", "description": null}],
  "revenueMilestones": [{"metric": "Revenue", "value": "$1M", "date": "2023", "context": "First million"}]
}`;

      const parsed = JSON.parse(aiResponse);
      expect(parsed.leadership).toHaveLength(1);
      expect(parsed.leadership[0].name).toBe('Alice');
      expect(parsed.funding.notableBackers).toContain('YC');
      expect(parsed.awardsAndRecognition[0].issuer).toBe('Forbes');
      expect(parsed.revenueMilestones[0].value).toBe('$1M');
    });
  });

  describe('Persuasion levers — urgency, scarcity, riskReversal, priceAnchoring, valueStacking', () => {
    it('should include all 5 persuasion fields in profile structure', () => {
      const profile = {
        urgency: {
          elements: ['Registration closes March 15', 'Early-bird pricing ends Friday'],
          summary: 'Time-limited registration and pricing offers',
        },
        scarcity: {
          elements: ['Only 10 spots available worldwide', 'Limited to 3 clients per quarter'],
          summary: 'Strictly limited capacity',
        },
        riskReversal: {
          guarantees: ['90-day money-back guarantee', 'Results guaranteed or full refund'],
          trialInfo: '2-week free trial period',
          refundPolicy: 'Full refund within 90 days, no questions asked',
        },
        priceAnchoring: {
          anchors: ['Total value: $25,000', 'Agencies charge $15K for this'],
          comparisonPoints: ['Get $25K of value for $997'],
        },
        valueStacking: {
          bundledValue: ['Press coverage ($5K value)', 'Podcast placement ($3K value)', 'Event speaking ($7K value)'],
          totalPerceivedValue: '$25,000+ in total value',
        },
      };

      expect(profile.urgency.elements).toHaveLength(2);
      expect(profile.urgency.summary).toContain('Time-limited');
      expect(profile.scarcity.elements).toHaveLength(2);
      expect(profile.riskReversal.guarantees).toHaveLength(2);
      expect(profile.riskReversal.trialInfo).toContain('2-week');
      expect(profile.riskReversal.refundPolicy).toContain('90 days');
      expect(profile.priceAnchoring.anchors).toHaveLength(2);
      expect(profile.priceAnchoring.comparisonPoints).toHaveLength(1);
      expect(profile.valueStacking.bundledValue).toHaveLength(3);
      expect(profile.valueStacking.totalPerceivedValue).toContain('$25,000');
    });

    it('should default persuasion fields to null when absent from LLM response', () => {
      const parsed: Record<string, unknown> = {};
      const urgency = parsed.urgency || null;
      const scarcity = parsed.scarcity || null;
      const riskReversal = parsed.riskReversal || null;
      const priceAnchoring = parsed.priceAnchoring || null;
      const valueStacking = parsed.valueStacking || null;

      expect(urgency).toBeNull();
      expect(scarcity).toBeNull();
      expect(riskReversal).toBeNull();
      expect(priceAnchoring).toBeNull();
      expect(valueStacking).toBeNull();
    });

    it('should parse persuasion fields from AI JSON response', () => {
      const aiResponse = `{
  "brandName": "TestCo",
  "valueProposition": "Best product",
  "urgency": {
    "elements": ["Offer expires Dec 31"],
    "summary": "Year-end deadline"
  },
  "scarcity": {
    "elements": ["5 spots remaining"],
    "summary": "Very limited availability"
  },
  "riskReversal": {
    "guarantees": ["30-day money-back"],
    "trialInfo": "14-day free trial",
    "refundPolicy": "Full refund within 30 days"
  },
  "priceAnchoring": {
    "anchors": ["Value: $10,000"],
    "comparisonPoints": ["Only $499 today"]
  },
  "valueStacking": {
    "bundledValue": ["Core product ($5K)", "Bonus coaching ($3K)", "Community access ($2K)"],
    "totalPerceivedValue": "$10,000 in total value"
  }
}`;

      const parsed = JSON.parse(aiResponse);
      expect(parsed.urgency.elements).toHaveLength(1);
      expect(parsed.urgency.summary).toBe('Year-end deadline');
      expect(parsed.scarcity.elements[0]).toContain('5 spots');
      expect(parsed.riskReversal.guarantees[0]).toContain('money-back');
      expect(parsed.riskReversal.trialInfo).toContain('14-day');
      expect(parsed.priceAnchoring.anchors[0]).toContain('$10,000');
      expect(parsed.valueStacking.bundledValue).toHaveLength(3);
      expect(parsed.valueStacking.totalPerceivedValue).toContain('$10,000');
    });

    it('should handle partial persuasion data (some fields null, some populated)', () => {
      const parsed = {
        urgency: { elements: ['Limited time offer'], summary: null },
        scarcity: null,
        riskReversal: { guarantees: [], trialInfo: null, refundPolicy: 'Cancel anytime' },
        priceAnchoring: null,
        valueStacking: { bundledValue: ['Feature A', 'Feature B'], totalPerceivedValue: null },
      };

      expect(parsed.urgency?.elements).toHaveLength(1);
      expect(parsed.urgency?.summary).toBeNull();
      expect(parsed.scarcity).toBeNull();
      expect(parsed.riskReversal?.guarantees).toHaveLength(0);
      expect(parsed.riskReversal?.refundPolicy).toBe('Cancel anytime');
      expect(parsed.priceAnchoring).toBeNull();
      expect(parsed.valueStacking?.bundledValue).toHaveLength(2);
      expect(parsed.valueStacking?.totalPerceivedValue).toBeNull();
    });
  });

  describe('JSON parsing', () => {
    it('should extract JSON from AI response', () => {
      const aiResponse = `Here is the analysis:

{
  "brandName": "Apollo.io",
  "valueProposition": "End-to-end sales automation"
}

Hope this helps!`;

      const match = aiResponse.match(/\{[\s\S]*\}/);
      expect(match).not.toBeNull();
      
      const parsed = JSON.parse(match![0]);
      expect(parsed.brandName).toBe('Apollo.io');
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
