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
  `);

  try { db.exec("ALTER TABLE clients ADD COLUMN drive_photos_url TEXT DEFAULT ''"); } catch (_) {}
  try { db.exec("ALTER TABLE clients ADD COLUMN drive_output_url TEXT DEFAULT ''"); } catch (_) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      selected_photos TEXT NOT NULL,
      script TEXT NOT NULL,
      higgsfield_prompt TEXT NOT NULL,
      midjourney_prompt TEXT NOT NULL,
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

function createClient({ name, business_type, location, brand_voice = '', drive_photos_url = '', drive_output_url = '' }) {
  const stmt = getDb().prepare(
    'INSERT INTO clients (name, business_type, location, brand_voice, drive_photos_url, drive_output_url) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(name, business_type, location, brand_voice, drive_photos_url, drive_output_url);
  return getClientById(result.lastInsertRowid);
}

function updateClient(id, { name, business_type, location, brand_voice, drive_photos_url = '', drive_output_url = '' }) {
  getDb().prepare(
    'UPDATE clients SET name = ?, business_type = ?, location = ?, brand_voice = ?, drive_photos_url = ?, drive_output_url = ? WHERE id = ?'
  ).run(name, business_type, location, brand_voice, drive_photos_url, drive_output_url, id);
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

function getUsedPhotoIds(clientId) {
  const jobs = getDb()
    .prepare('SELECT selected_photos FROM media_jobs WHERE client_id = ?')
    .all(clientId);
  return jobs.flatMap(job => {
    try { return JSON.parse(job.selected_photos).map(p => p.id); } catch (_) { return []; }
  });
}

function createMediaJob({ clientId, selectedPhotos, script, higgsfieldPrompt, midjourneyPrompt }) {
  const result = getDb()
    .prepare(`INSERT INTO media_jobs (client_id, selected_photos, script, higgsfield_prompt, midjourney_prompt)
              VALUES (?, ?, ?, ?, ?)`)
    .run(clientId, selectedPhotos, script, higgsfieldPrompt, midjourneyPrompt);
  return getDb().prepare('SELECT * FROM media_jobs WHERE id = ?').get(result.lastInsertRowid);
}

function getMediaJobsByClientId(clientId) {
  return getDb()
    .prepare('SELECT * FROM media_jobs WHERE client_id = ? ORDER BY created_at DESC')
    .all(clientId);
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
  getUsedPhotoIds,
  createMediaJob,
  getMediaJobsByClientId,
  closeDb,
};
