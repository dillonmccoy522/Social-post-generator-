const express = require('express');
const router = express.Router();
const db = require('../database');

const TYPES = ['image', 'video'];
const STATUSES = ['queued', 'generating', 'failed', 'draft', 'approved', 'posted'];

router.get('/', (req, res) => {
  const { clientId, status, campaign } = req.query;
  if (status && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  res.json(db.getAssets({ clientId: clientId ? Number(clientId) : undefined, status, campaign }));
});

router.post('/', (req, res) => {
  const { client_id, type, status = 'draft' } = req.body;
  if (!client_id || !type) return res.status(400).json({ error: 'client_id and type are required' });
  if (!TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${TYPES.join(', ')}` });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  if (!db.getClientById(Number(client_id))) return res.status(400).json({ error: 'client not found' });
  const asset = db.createAsset({ ...req.body, client_id: Number(client_id) });
  res.status(201).json(asset);
});

router.patch('/:id', (req, res) => {
  const existing = db.getAssetById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Asset not found' });
  if (req.body.status && !STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  }
  res.json(db.updateAsset(Number(req.params.id), req.body));
});

router.delete('/:id', (req, res) => {
  const existing = db.getAssetById(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Asset not found' });
  db.deleteAsset(Number(req.params.id));
  res.status(204).send();
});

module.exports = router;
