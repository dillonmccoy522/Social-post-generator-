const express = require('express');
const router = express.Router();
const drive = require('../services/drive');

router.get('/browse', async (req, res) => {
  if (!drive.isConfigured()) {
    return res.status(503).json({ error: 'Google Drive not configured' });
  }
  try {
    res.json(await drive.browse(req.query.folderId || 'root'));
  } catch (err) {
    res.status(502).json({ error: `Drive error: ${err.message}` });
  }
});

module.exports = router;
