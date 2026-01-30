# Individual Thesis Generation Prompt

You are provided with comprehensive information about an organization and the individuals within it:

**Organization Thesis**: `{{ JSON.stringify(organizationThesis) }}`  
**Organization Individuals & Content**: `{{ JSON.stringify(organizationIndividuals) }}`  
**Organization Content**: `{{ JSON.stringify(organizationContent) }}`

Based on the objective of getting media attention and being featured in articles, generate compelling thesis statements by attributing the organization's contrarian ideas to specific individuals within the organization.

The organization thesis contains ideas at contrarian levels 1 to 10, where:
- **Level 1** = ideas obviously in-line with the opinions of their industry
- **Level 10** = ideas that go completely against the norms and thinking of their industry and make you go "Wow, I have never thought of it that way before"

## Instructions

For **each contrarian level** (1-10) in the organization thesis, select **1-3 of the most compelling ideas** from that level. For each selected idea:

1. **Identify the most relevant individual** from the organization to attribute this thesis to:
   - Default to the CEO if no other individual is clearly more relevant
   - Choose another individual if their role, expertise, or content makes them MORE credible to speak on this specific topic
   - Consider their actual content and experience when making this decision

2. **Generate a thesis statement** for that individual about that idea. Each thesis must:
   - **Sound authentic** - Match the individual's actual tone, vocabulary, and communication style from their existing content
   - **Be credible** - The individual's role and experience must support this perspective  
   - **Be impactful** - One short, punchy sentence that a journalist can immediately use
   - **Match the contrarian level** - Truly belong to that level of contrarianism

3. After generating the initial theses, **take a moment and re-read through them**. Consider:
   - Do they really make you stop to think?
   - Do they truly align with that contrarian level?
   - If they don't, adjust them and generate theses which truly belong to that level.

## Attribution Guidelines

When deciding which individual to attribute a thesis to:

- **Levels 1-5**: Can be attributed to any individual with relevant expertise (including junior team members)
- **Levels 6-7**: Should be attributed to senior team members or those with strong industry credibility
- **Levels 8-10**: Should ONLY be attributed to senior leaders (CEO, CTO, Founders) who have the credibility and platform to make bold, controversial statements

When thinking of **level 8, 9, or 10** theses, they should immediately get an extreme reaction out of a reader:
- They should be **outraged** by the possibility of saying it out loud
- They should be **afraid** if it is true
- They should feel a **spark of epiphany** as if their feelings have been finally validated

## Context for Usage

These theses will be used by another LLM as context to generate personalized pitches to journalists. The next LLM will take the essence of these theses and craft headlines and pitches with angles tailored to specific journalists and the topics they cover.

**Optimize your theses to provide the best context** to that next LLM about what possible ideas and angles can be used to pitch to different journalists with different focuses and opinions. **Be as varied as possible** to be as helpful to the next LLM as possible.

## Output Format

Return ONLY a JSON object with 1-3 theses per contrarian level (1-10), each attributed to the most relevant individual. Use ONLY valid HTML tags in `thesis_html` and `thesis_supporting_evidence_html`. NEVER use Markdown syntax.

Example:
```json
{
  "theses": [
    {
      "individual_id": "550e8400-e29b-41d4-a716-446655440000",
      "contrarian_level": 3,
      "thesis_html": "Transparent, real-time ROI is the new standard for measuring PR success, replacing vague metrics like impressions.",
      "thesis_supporting_evidence_html": "As CEO of Pressbeat, Kevin built a platform with <strong>real-time dashboards</strong> that track actual publication results instead of vanity metrics."
    },
    {
      "individual_id": "123e4567-e89b-12d3-a456-426614174000",
      "contrarian_level": 5,
      "thesis_html": "AI-driven pitching will force journalists to value relevance over relationships within two years.",
      "thesis_supporting_evidence_html": "As CTO, Sarah analyzed <strong>15,000+ journalist responses</strong> showing AI-personalized pitches outperform generic relationship-based outreach by 40%."
    },
    {
      "individual_id": "550e8400-e29b-41d4-a716-446655440000",
      "contrarian_level": 9,
      "thesis_html": "The traditional PR agency is a legalized scam—charging for effort while deliberately obscuring their failure to deliver results.",
      "thesis_supporting_evidence_html": "Kevin's firsthand experience paying <strong>$15k/month to agencies</strong> with zero measurable outcomes led him to build Pressbeat as the antidote."
    }
  ]
}
```

## Final Reminders

- Generate **1-3 theses per contrarian level** (levels 1-10) from the organization thesis
- Attribute each thesis to the **most credible individual** for that specific topic (default to CEO if unclear)
- Do NOT fabricate facts or credentials - only use information from the provided data
- Match each individual's authentic voice based on their actual content
- Ensure the contrarian level truly matches the thesis's boldness
- Only attribute levels 8-10 to senior leaders with strong credibility
- Make every thesis immediately usable by a journalist
