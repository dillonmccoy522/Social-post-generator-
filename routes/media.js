const express = require('express');
const router = express.Router();
const { requireAuth } = require('../lib/google-auth');
const { downloadPhotoAsBase64, writeOutputFile, folderIdFromUrl } = require('../lib/drive');
const { selectPhotosAndGeneratePlan } = require('../lib/media-prompt');
const db = require('../database');

router.post('/generate', requireAuth, async (req, res) => {
  const { clientId, photos } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  if (!photos || !Array.isArray(photos) || photos.length === 0) return res.status(400).json({ error: 'photos array is required' });
  const client = db.getClientById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  try {
    const photosWithData = await Promise.all(
      photos.map(async (photo) => {
        const { data, mimeType } = await downloadPhotoAsBase64(req.googleAuth, photo.id);
        return { ...photo, data, mimeType };
      })
    );
    const plan = await selectPhotosAndGeneratePlan(client, photosWithData);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save', requireAuth, async (req, res) => {
  const { clientId, plan } = req.body;
  if (!clientId || !plan) return res.status(400).json({ error: 'clientId and plan are required' });
  const client = db.getClientById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const job = db.createMediaJob({
    clientId,
    selectedPhotos: JSON.stringify(plan.selectedPhotos || []),
    script: plan.script || '',
    higgsfieldPrompt: plan.higgsfieldPrompt || '',
    midjourneyPrompt: plan.midjourneyPrompt || '',
  });

  if (client.drive_output_url) {
    try {
      const folderId = folderIdFromUrl(client.drive_output_url);
      const date = new Date().toISOString().split('T')[0];
      const content = [
        `Niewdel Media Plan — ${client.name} — ${date}`,
        '', 'MARKETING SCRIPT', plan.script,
        '', 'HIGGSFIELD VIDEO PROMPT', plan.higgsfieldPrompt,
        '', 'MIDJOURNEY IMAGE PROMPT', plan.midjourneyPrompt,
        '', 'SELECTED PHOTOS',
        ...(plan.selectedPhotos || []).map(p => `- ${p.name}: ${p.reason}`),
      ].join('\n');
      await writeOutputFile(req.googleAuth, folderId, `niewdel-media-${date}.txt`, content);
    } catch (err) {
      console.error('Drive output write failed:', err.message);
    }
  }
  res.json({ job });
});

router.get('/history/:clientId', async (req, res) => {
  const client = db.getClientById(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ jobs: db.getMediaJobsByClientId(req.params.clientId) });
});

module.exports = router;
