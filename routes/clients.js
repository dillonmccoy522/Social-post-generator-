const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (req, res) => {
  res.json(db.getAllClients());
});

router.post('/', (req, res) => {
  const { name, business_type, location, brand_voice = '' } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }
  const client = db.createClient({ name, business_type, location, brand_voice });
  res.status(201).json(client);
});

router.put('/:id', (req, res) => {
  const { name, business_type, location, brand_voice = '' } = req.body;
  if (!name || !business_type || !location) {
    return res.status(400).json({ error: 'name, business_type, and location are required' });
  }
  const existing = db.getClientById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  const updated = db.updateClient(req.params.id, { name, business_type, location, brand_voice });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  db.deleteClient(req.params.id);
  res.status(204).send();
});

module.exports = router;
