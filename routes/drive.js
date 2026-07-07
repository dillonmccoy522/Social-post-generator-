const express = require('express');
const router = express.Router();
const { requireAuth } = require('../lib/google-auth');
const { folderIdFromUrl, listPhotos } = require('../lib/drive');
const db = require('../database');

router.get('/scan/:clientId', requireAuth, async (req, res) => {
  const client = db.getClientById(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.drive_photos_url) return res.status(400).json({ error: 'Client has no photos folder configured' });

  let folderId;
  try { folderId = folderIdFromUrl(client.drive_photos_url); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const usedFileIds = db.getUsedPhotoIds(client.id);
    const photos = await listPhotos(req.googleAuth, folderId, usedFileIds);
    if (photos.length === 0) return res.json({ photos: [], message: 'All photos in this folder have been used' });
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
