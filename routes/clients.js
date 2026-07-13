const express = require('express');
const router = express.Router();
const db = require('../database');
const drive = require('../services/drive');

// Normalize an optional pasted Drive link into a folder id.
// Returns { id } (id is null when blank) on success, or { error: true } if unparseable.
function parseOptionalLink(rawLink) {
  if (!rawLink) return { id: null };
  const id = drive.parseFolderId(rawLink);
  return id ? { id } : { error: true };
}

router.get('/', (_req, res) => {
  res.json(db.getAllClients());
});

router.get('/:id', (req, res) => {
  const client = db.getClientById(Number(req.params.id));
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

router.post('/', (req, res) => {
  const { name, business_type, location, brand_voice = '',
          source_drive_folder_id: rawSource, output_drive_folder_id: rawOutput } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }
  const source = parseOptionalLink(rawSource);
  if (source.error) return res.status(400).json({ error: 'Pull-from Drive folder link is not recognizable' });
  const output = parseOptionalLink(rawOutput);
  if (output.error) return res.status(400).json({ error: 'Send-to Drive folder link is not recognizable' });

  const client = db.createClient({
    name, business_type, location, brand_voice,
    source_drive_folder_id: source.id,
    output_drive_folder_id: output.id,
  });
  res.status(201).json(client);
});

router.put('/:id', (req, res) => {
  const { name, business_type, location, brand_voice = '',
          source_drive_folder_id: rawSource, output_drive_folder_id: rawOutput } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }
  const existing = db.getClientById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const source = parseOptionalLink(rawSource);
  if (source.error) return res.status(400).json({ error: 'Pull-from Drive folder link is not recognizable' });
  const output = parseOptionalLink(rawOutput);
  if (output.error) return res.status(400).json({ error: 'Send-to Drive folder link is not recognizable' });

  const updated = db.updateClient(req.params.id, {
    name, business_type, location, brand_voice,
    source_drive_folder_id: source.id,
    output_drive_folder_id: output.id,
  });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = db.getClientById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  db.deleteClient(Number(req.params.id));
  res.status(204).send();
});

module.exports = router;
