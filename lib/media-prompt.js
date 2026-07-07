const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(client) {
  return `You are a marketing content strategist for local service businesses. Analyze job site photos to plan compelling marketing videos and images.

Client: ${client.name}
Business Type: ${client.business_type}
Location: ${client.location}
Brand Voice: ${client.brand_voice || 'Professional and approachable'}

Select the 5-10 best photos for marketing. Respond in this EXACT format:

SELECTED PHOTOS
1: [one sentence why this photo is valuable for marketing]
2: [one sentence why this photo is valuable for marketing]
(numbered by order received, one line each)

SCRIPT
[3-5 sentences. What should this make the viewer feel and do? Be specific to the business and work shown.]

HIGGSFIELD PROMPT
[Cinematic video prompt referencing visual elements from the selected photos. Include camera movement, mood, lighting. 2-4 sentences.]

MIDJOURNEY PROMPT
[Image generation prompt with style, mood, subject, composition. End with --ar 9:16 --style raw]`;
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
