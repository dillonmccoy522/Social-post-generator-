require('dotenv').config();
const express = require('express');
const path = require('path');

const clientsRouter = require('./routes/clients');
const generateRouter = require('./routes/generate');
const postsRouter = require('./routes/posts');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/clients', clientsRouter);
app.use('/api/generate', generateRouter);
app.use('/api/posts', postsRouter);

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\nNiewdel Social Dashboard running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
