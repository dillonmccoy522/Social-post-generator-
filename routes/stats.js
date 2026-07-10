const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/', (_req, res) => res.json(db.getStats()));

module.exports = router;
