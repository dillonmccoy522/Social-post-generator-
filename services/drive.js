const { google } = require('googleapis');
const { Readable } = require('stream');

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

function parseFolderId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

function getDrive() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth });
}

const FILE_FIELDS = 'files(id, name, mimeType, thumbnailLink, webViewLink)';

function isMedia(f) {
  return f.mimeType === 'application/vnd.google-apps.folder'
    || f.mimeType.startsWith('image/')
    || f.mimeType.startsWith('video/');
}

async function browse(folderId = 'root') {
  const { data } = await getDrive().files.list({
    q: `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed = false`,
    fields: FILE_FIELDS,
    pageSize: 200,
    orderBy: 'folder,name',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return (data.files || []).filter(isMedia);
}

async function ensureFolder(name, parentId) {
  const drive = getDrive();
  const escaped = name.replace(/'/g, "\\'");
  const { data } = await drive.files.list({
    q: `'${String(parentId).replace(/'/g, "\\'")}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (data.files && data.files.length > 0) return data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function uploadFromUrl(url, filename, clientName, campaign) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') || 'application/octet-stream';

  const root = process.env.OUTPUT_DRIVE_FOLDER_ID;
  if (!root) throw new Error('OUTPUT_DRIVE_FOLDER_ID is not set');
  const clientFolder = await ensureFolder(clientName, root);
  const parent = campaign ? await ensureFolder(campaign, clientFolder) : clientFolder;

  const created = await getDrive().files.create({
    requestBody: { name: filename, parents: [parent] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink, thumbnailLink',
    supportsAllDrives: true,
  });
  return created.data;
}

// Download a remote file and upload it directly into a specific Drive folder.
async function uploadToFolder(url, filename, folderId) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') || 'application/octet-stream';

  const created = await getDrive().files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink, thumbnailLink',
    supportsAllDrives: true,
  });
  return created.data;
}

module.exports = { isConfigured, parseFolderId, browse, ensureFolder, uploadFromUrl, uploadToFolder };
