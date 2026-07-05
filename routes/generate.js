const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../database');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PILLARS = ['Job Showcase', 'Education/Trust', 'Local/Community'];

function getNextPillars(lastPillar) {
  if (!lastPillar) return [...PILLARS];
  const lastIndex = PILLARS.indexOf(lastPillar);
  return [
    PILLARS[(lastIndex + 1) % 3],
    PILLARS[(lastIndex + 2) % 3],
    PILLARS[(lastIndex + 3) % 3],
  ];
}

function buildSystemPrompt(client, pillars) {
  return `You are a social media content writer for a local service business. You write engaging, authentic posts for Instagram and Facebook.

Client: ${client.name}
Business Type: ${client.business_type}
Location: ${client.location}
Brand Voice: ${client.brand_voice || 'Professional and approachable'}

This week write exactly 3 posts, one per content pillar in this order:
1. ${pillars[0]}
2. ${pillars[1]}
3. ${pillars[2]}

Pillar definitions:
- Job Showcase: Before/after results, project spotlights, real work highlights. Show the quality of the work.
- Education/Trust: Tips, what to look for, how to protect your home, warning signs. Position as a local expert.
- Local/Community: San Antonio and surrounding areas focus, neighborhood mentions, local pride, community connection.

Format each post EXACTLY like this (no extra blank lines between fields):

POST 1 — [Pillar Name]
Photo: [reference the photo description provided]
Caption: [2-4 sentences, conversational, specific, no generic phrases like "quality you can trust"]
Hashtags: [8-12 hashtags — mix local (#SanAntonio, #SATXRoofing, #BoerneRoofing) and niche (#RoofReplacement, #RoofingContractor)]
CTA: [one direct action line]

POST 2 — [Pillar Name]
Photo: [reference the photo description]
Caption: [2-4 sentences]
Hashtags: [8-12 hashtags]
CTA: [one direct action line]

POST 3 — [Pillar Name]
Photo: [reference the photo description]
Caption: [2-4 sentences]
Hashtags: [8-12 hashtags]
CTA: [one direct action line]

Rules:
- Write naturally, like a real local business owner proud of their work
- Be specific — use details from the photos and job info provided
- Never use filler phrases like "quality you can trust", "serving your needs", or "we've got you covered"
- Each CTA should be direct and actionable`;
}

function parsePostsFromContent(content) {
  const parts = content.split(/(?=POST \d)/);
  return parts.filter(p => p.trim()).slice(0, 3).map(p => p.trim());
}

router.post('/', async (req, res) => {
  const { clientId, photos, jobDetails, cta } = req.body;

  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  if (!photos || !Array.isArray(photos) || photos.length !== 3) {
    return res.status(400).json({ error: '3 photo descriptions are required' });
  }

  const client = db.getClientById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const pillars = getNextPillars(client.last_pillar);

  const userMessage = `Photo 1: ${photos[0]}
Photo 2: ${photos[1]}
Photo 3: ${photos[2]}${jobDetails ? `\nJob Details: ${jobDetails}` : ''}
CTA Preference: ${cta || 'Call for a free inspection — no pressure, just answers'}`;

  let message;
  try {
    message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: buildSystemPrompt(client, pillars),
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const generatedContent = message.content[0].text;
  const parsedPosts = parsePostsFromContent(generatedContent);
  const weekOf = new Date().toISOString().split('T')[0];

  db.updateClientLastPillar(clientId, pillars[2]);

  db.createPost({
    clientId,
    weekOf,
    photoDescriptions: JSON.stringify(photos),
    generatedContent,
  });

  res.json({ posts: parsedPosts });
});

module.exports = router;
