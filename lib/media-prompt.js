const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(client) {
  return `You are a social media marketing strategist specializing in local home service businesses. Your job is to turn real job site photos into compelling Facebook and Instagram content that builds community trust and drives calls.

Client: ${client.name}
Business Type: ${client.business_type}
Location: ${client.location}
Brand Voice: ${client.brand_voice || 'Professional, trustworthy, community-focused'}

BRAND DIRECTION: Community trust. This is a professional roofing company that serves real families in their neighborhood. The tone is warm but confident — not salesy, not generic. Everything should feel like it comes from a contractor who takes pride in their work and genuinely cares about the homeowners they serve.

Look at the photos carefully. Identify:
- The actual roof color, style, and materials visible
- The home type (ranch, two-story, brick, etc.)
- The neighborhood/surroundings
- Any before/after contrast visible
- Signs of craftsmanship or crew professionalism

Use these SPECIFIC DETAILS in everything you write. Never invent details not visible in the photos.

Select the best 3-5 photos for marketing. Respond in this EXACT format:

SELECTED PHOTOS
1: [one sentence describing what makes this photo marketing-worthy — be specific about what you see]
2: [one sentence]
(numbered by order received, one line each)

SCRIPT
[3-5 sentences for a Facebook/Instagram caption or video voiceover. Lead with something specific from the photos — the actual home, the roof color, the neighborhood. Make the homeowner the hero. End with a soft but direct CTA referencing ${client.location}. No generic filler phrases like "quality you can trust" or "we've got you covered".]

HIGGSFIELD PROMPT
[Video prompt grounded in what's actually in the photos. Reference the real roof color, home style, and surroundings you can see. Use community-trust visual language: steady camera moves, warm natural light, residential streets, proud homeowners. 2-3 sentences. Do NOT invent details not visible in the photos.]

MIDJOURNEY PROMPT
[Marketing image prompt based on what you actually see in the photos. Describe the real roof, real home style, real neighborhood feel. Warm golden hour light, photorealistic, community-trust aesthetic, Facebook/Instagram ad composition. End with --ar 9:16 --style raw]`;
}

function parseResponse(text, photos) {
  const selectedPhotos = [];
  const selectedMatch = text.match(/SELECTED PHOTOS\n([\s\S]*?)(?=\n\nSCRIPT|\nSCRIPT)/);
  if (selectedMatch) {
    selectedMatch[1].trim().split('\n').forEach(line => {
      const m = line.match(/^(\d+):\s*(.+)$/);
      if (!m) return;
      const photo = photos[parseInt(m[1], 10) - 1];
      if (photo) selectedPhotos.push({ id: photo.id, name: photo.name, reason: m[2].trim() });
    });
  }
  const scriptMatch = text.match(/SCRIPT\n([\s\S]*?)(?=\n\nHIGGSFIELD PROMPT|\nHIGGSFIELD PROMPT)/);
  const higgsfieldMatch = text.match(/HIGGSFIELD PROMPT\n([\s\S]*?)(?=\n\nMIDJOURNEY PROMPT|\nMIDJOURNEY PROMPT)/);
  const midjourneyMatch = text.match(/MIDJOURNEY PROMPT\n([\s\S]*?)$/);
  return {
    selectedPhotos,
    script: scriptMatch ? scriptMatch[1].trim() : '',
    higgsfieldPrompt: higgsfieldMatch ? higgsfieldMatch[1].trim() : '',
    midjourneyPrompt: midjourneyMatch ? midjourneyMatch[1].trim() : '',
  };
}

async function selectPhotosAndGeneratePlan(client, photos) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: buildSystemPrompt(client),
    messages: [{
      role: 'user',
      content: [
        ...photos.map(p => ({ type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } })),
        { type: 'text', text: `Here are ${photos.length} photos from ${client.name}'s recent work. Select the best and generate the plan.` },
      ],
    }],
  });
  return parseResponse(message.content[0].text, photos);
}

module.exports = { selectPhotosAndGeneratePlan };
