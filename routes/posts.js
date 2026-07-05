const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', async (req, res) => {
  try {
    const { clientId } = req.query;
    if (clientId) {
      const id = parseInt(clientId, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid clientId' });
      return res.json(db.getPostsByClientId(id));
    }
    res.json(db.getAllPosts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
