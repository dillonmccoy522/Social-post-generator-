require('dotenv').config();
const express = require('express');
const path = require('path');

const clientsRouter = require('./routes/clients');
const generateRouter = require('./routes/generate');
const postsRouter = require('./routes/posts');
const assetsRouter = require('./routes/assets');
const statsRouter = require('./routes/stats');
const driveRouter = require('./routes/drive');

const app = express();

app.use(express.json());

const { requireAuth } = require('./middleware/auth');
const authRouter = require('./routes/auth');

app.use(requireAuth);
app.use('/api', authRouter);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/clients', clientsRouter);
app.use('/api/generate', generateRouter);
app.use('/api/posts', postsRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/drive', driveRouter);

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
