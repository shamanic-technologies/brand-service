# Organization Thesis Generation Prompt

You are provided the following comprehensive and professional media kit for our client: "{{ JSON.stringify($('Read complete organization information').item.json.get_complete_organization_data) }}".

Based on the objective of getting media attention and being featured in articles, generate 3-5 thesis statements/headlines for EACH level of contrarianism from 1 to 10 based on the organization's stance, data, and mission.

**Contrarian Scale:**
- **Level 1:** Ideas that are obviously in-line with the standard opinions of their industry.
- **Level 10:** Ideas that go completely against the norms and thinking of their industry and make you go "Wow, I have never thought of it that way before." These should be ideas not usually mentioned online or that are extremely polarizing.

**Instructions:**

1.  **Generate Ideas:** For every level (1-10), brainstorm ideas based on the organization's unique position.
2.  **Review & Refine:** Re-read your ideas. Do they truly match the level? Do the Level 10 ideas shock or validate a hidden truth? Adjust until they are perfect.
3.  **Create Headlines:** Turn these ideas into punchy, potential article headlines (`thesis_html`).
    - **Levels 8-10 Headlines:** Must evoke an immediate extreme reaction (outrage, fear, or epiphany).
4.  **Justify:** For each headline, summarize why THIS organization is the best entity to speak on this topic (`thesis_supporting_evidence_html`). Why them and not a bigger competitor? Focus on their unique data, specific experience, or "secret sauce."

**Goal:**
These outputs will be used by another AI to generate personalized pitches. Your goal is to provide a diverse range of strong, validated angles that can be matched to different types of journalists.

## Output Format

Return ONLY a JSON object that strictly adheres to the provided schema.

The JSON object must contain a `theses` array, where each item contains:
- `contrarian_level`: The level (1-10).
- `thesis_html`: The generated headline or thesis statement formatted as HTML.
- `thesis_supporting_evidence_html`: The justification/evidence formatted as HTML.

Use ONLY valid HTML tags in `thesis_html` and `thesis_supporting_evidence_html`. NEVER use Markdown syntax.
