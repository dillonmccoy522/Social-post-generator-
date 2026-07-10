require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'dashboard.db');

let db;

function getDb() {
  if (!db) {
    if (DB_PATH !== ':memory:') {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      business_type TEXT NOT NULL,
      location TEXT NOT NULL,
      brand_voice TEXT DEFAULT '',
      last_pillar TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      week_of DATE NOT NULL,
      photo_descriptions TEXT NOT NULL,
      generated_content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      campaign TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK (type IN ('image','video')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('queued','generating','failed','draft','approved','posted')),
      prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      source_drive_file_id TEXT DEFAULT NULL,
      output_drive_file_id TEXT DEFAULT NULL,
      output_drive_url TEXT DEFAULT NULL,
      thumbnail_url TEXT DEFAULT NULL,
      higgsfield_job_id TEXT DEFAULT NULL,
      error TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getAllClients() {
  return getDb().prepare('SELECT * FROM clients ORDER BY name ASC').all();
}

function getClientById(id) {
  return getDb().prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

function createClient({ name, business_type, location, brand_voice = '' }) {
  const stmt = getDb().prepare(
    'INSERT INTO clients (name, business_type, location, brand_voice) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(name, business_type, location, brand_voice);
  return getClientById(result.lastInsertRowid);
}

function updateClient(id, { name, business_type, location, brand_voice }) {
  getDb().prepare(
    'UPDATE clients SET name = ?, business_type = ?, location = ?, brand_voice = ? WHERE id = ?'
  ).run(name, business_type, location, brand_voice, id);
  return getClientById(id);
}

function deleteClient(id) {
  getDb().prepare('DELETE FROM clients WHERE id = ?').run(id);
}

function updateClientLastPillar(id, pillar) {
  getDb().prepare('UPDATE clients SET last_pillar = ? WHERE id = ?').run(pillar, id);
}

function createPost({ clientId, weekOf, photoDescriptions, generatedContent }) {
  const stmt = getDb().prepare(
    'INSERT INTO posts (client_id, week_of, photo_descriptions, generated_content) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(clientId, weekOf, photoDescriptions, generatedContent);
  return getDb().prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
}

function getPostsByClientId(clientId) {
  return getDb().prepare(`
    SELECT posts.*, clients.name as client_name
    FROM posts
    JOIN clients ON posts.client_id = clients.id
    WHERE posts.client_id = ?
    ORDER BY posts.created_at DESC
  `).all(clientId);
}

function getAllPosts() {
  return getDb().prepare(`
    SELECT posts.*, clients.name as client_name
    FROM posts
    JOIN clients ON posts.client_id = clients.id
    ORDER BY posts.created_at DESC
  `).all();
}

const ASSET_UPDATE_FIELDS = ['campaign', 'status', 'prompt', 'model', 'source_drive_file_id',
  'output_drive_file_id', 'output_drive_url', 'thumbnail_url', 'higgsfield_job_id', 'error'];

function createAsset({ client_id, campaign = '', type, status = 'draft', prompt = '', model = '',
  source_drive_file_id = null, output_drive_file_id = null, output_drive_url = null,
  thumbnail_url = null, higgsfield_job_id = null }) {
  const stmt = getDb().prepare(`
    INSERT INTO assets (client_id, campaign, type, status, prompt, model, source_drive_file_id,
      output_drive_file_id, output_drive_url, thumbnail_url, higgsfield_job_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(client_id, campaign, type, status, prompt, model, source_drive_file_id,
    output_drive_file_id, output_drive_url, thumbnail_url, higgsfield_job_id);
  return getAssetById(result.lastInsertRowid);
}

function getAssetById(id) {
  return getDb().prepare(`
    SELECT assets.*, clients.name AS client_name
    FROM assets JOIN clients ON assets.client_id = clients.id
    WHERE assets.id = ?
  `).get(id);
}

function getAssets({ clientId, status, campaign } = {}) {
  const where = [];
  const params = [];
  if (clientId) { where.push('assets.client_id = ?'); params.push(clientId); }
  if (status) { where.push('assets.status = ?'); params.push(status); }
  if (campaign) { where.push('assets.campaign = ?'); params.push(campaign); }
  return getDb().prepare(`
    SELECT assets.*, clients.name AS client_name
    FROM assets JOIN clients ON assets.client_id = clients.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY assets.created_at DESC, assets.id DESC
  `).all(...params);
}

function updateAsset(id, fields) {
  const keys = Object.keys(fields).filter(k => ASSET_UPDATE_FIELDS.includes(k));
  if (keys.length === 0) return getAssetById(id);
  const set = keys.map(k => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE assets SET ${set} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
  return getAssetById(id);
}

function deleteAsset(id) {
  getDb().prepare('DELETE FROM assets WHERE id = ?').run(id);
}

function getStats() {
  const d = getDb();
  const clients = d.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  const postsThisWeek = d.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE created_at >= datetime('now', '-7 days')"
  ).get().n;
  const assetsByStatus = { queued: 0, generating: 0, failed: 0, draft: 0, approved: 0, posted: 0 };
  for (const row of d.prepare('SELECT status, COUNT(*) AS n FROM assets GROUP BY status').all()) {
    assetsByStatus[row.status] = row.n;
  }
  const recentActivity = d.prepare(`
    SELECT * FROM (
      SELECT 'post' AS kind, clients.name AS client_name,
             'text posts · week of ' || posts.week_of AS label, posts.created_at
      FROM posts JOIN clients ON posts.client_id = clients.id
      UNION ALL
      SELECT 'asset' AS kind, clients.name AS client_name,
             assets.type || CASE WHEN assets.campaign != '' THEN ' · ' || assets.campaign ELSE '' END AS label,
             assets.created_at
      FROM assets JOIN clients ON assets.client_id = clients.id
    ) ORDER BY created_at DESC LIMIT 10
  `).all();
  return { clients, postsThisWeek, assetsByStatus, recentActivity };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  updateClientLastPillar,
  createPost,
  getPostsByClientId,
  getAllPosts,
  createAsset,
  getAssetById,
  getAssets,
  updateAsset,
  deleteAsset,
  getStats,
  closeDb,
};
