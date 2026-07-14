const express = require('express');
const router = express.Router();
const db = require('../database');
const drive = require('../services/drive');

router.get('/', (_req, res) => {
  res.json(db.getAllClients());
});

router.get('/:id', (req, res) => {
  const client = db.getClientById(Number(req.params.id));
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

router.post('/', async (req, res) => {
  const { name, business_type, location, brand_voice = '', source_drive_folder_id: rawLink } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }

  let source_drive_folder_id = null;
  if (rawLink) {
    source_drive_folder_id = drive.parseFolderId(rawLink);
    if (!source_drive_folder_id) {
      return res.status(400).json({ error: 'Source Drive folder link is not recognizable' });
    }
  }

  let client = db.createClient({ name, business_type, location, brand_voice, source_drive_folder_id });

  if (drive.isConfigured()) {
    try {
      const folderId = await drive.ensureFolder(client.name, process.env.OUTPUT_DRIVE_FOLDER_ID);
      client = db.setClientOutputFolder(client.id, folderId);
    } catch (err) {
      console.error('Failed to create output Drive folder for client', client.id, err.message);
    }
  }

  res.status(201).json(client);
});

router.put('/:id', (req, res) => {
  const { name, business_type, location, brand_voice = '', source_drive_folder_id: rawLink } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }
  const existing = db.getClientById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  let source_drive_folder_id = null;
  if (rawLink) {
    source_drive_folder_id = drive.parseFolderId(rawLink);
    if (!source_drive_folder_id) {
      return res.status(400).json({ error: 'Source Drive folder link is not recognizable' });
    }
  }

  const updated = db.updateClient(req.params.id, { name, business_type, location, brand_voice, source_drive_folder_id });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = db.getClientById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  db.deleteClient(Number(req.params.id));
  res.status(204).send();
});

module.exports = router;
