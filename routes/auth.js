const express = require('express');
const router = express.Router();
const { sessionToken } = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.DASHBOARD_PASSWORD || password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  res.setHeader(
    'Set-Cookie',
    `session=${sessionToken()}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`
  );
  res.status(204).send();
});

router.get('/me', (_req, res) => res.json({ ok: true }));

module.exports = router;
