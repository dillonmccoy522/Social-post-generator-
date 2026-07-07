const express = require('express');
const router = express.Router();
const { getOAuthClient, getAuthUrl, saveTokens } = require('../lib/google-auth');

router.get('/google', (req, res) => {
  res.redirect(getAuthUrl());
});

router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No auth code provided');
  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    saveTokens(tokens);
    res.redirect('/?auth=success');
  } catch (err) {
    res.status(500).send('Auth failed: ' + err.message);
  }
});

module.exports = router;
