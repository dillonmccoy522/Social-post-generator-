const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (req, res) => {
  const { clientId } = req.query;
  if (clientId) {
    return res.json(db.getPostsByClientId(clientId));
  }
  res.json(db.getAllPosts());
});

module.exports = router;
