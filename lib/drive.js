const { google } = require('googleapis');
const { Readable } = require('stream');
const sharp = require('sharp');

function folderIdFromUrl(url) {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Invalid Google Drive folder URL');
  return match[1];
}

async function listPhotos(auth, folderId, usedFileIds = []) {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime, thumbnailLink)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  return (response.data.files || [])
    .filter(f => !usedFileIds.includes(f.id))
    .slice(0, 20);
}

async function downloadPhotoAsBase64(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const raw = Buffer.from(response.data);
  const resized = await sharp(raw)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  return {
    data: resized.toString('base64'),
    mimeType: 'image/jpeg',
  };
}

async function downloadPhotoThumb(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  const meta = await drive.files.get({
    fileId,
    fields: 'thumbnailLink',
    supportsAllDrives: true,
  });
  if (meta.data.thumbnailLink) {
    const res = await auth.request({ url: meta.data.thumbnailLink, responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  }
  // fallback for files without a Drive thumbnail
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const raw = Buffer.from(response.data);
  return await sharp(raw)
    .resize(240, 240, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toBuffer();
}

async function getOrCreateSubfolder(auth, parentFolderId, folderName) {
  const drive = google.drive({ version: 'v3', auth });
  const check = await drive.files.list({
    q: `'${parentFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (check.data.files && check.data.files.length > 0) return check.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] },
    supportsAllDrives: true,
    fields: 'id',
  });
  return created.data.id;
}

async function downloadPhotoBuffer(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const raw = Buffer.from(response.data);
  try {
    await sharp(raw).metadata();
    return raw;
  } catch (sharpErr) {
    try {
      const heicConvert = require('heic-convert');
      const output = await heicConvert({ buffer: raw, format: 'JPEG', quality: 1 });
      return Buffer.from(output);
    } catch (heicErr) {
      throw new Error(`Cannot decode image (sharp: ${sharpErr.message} / heic-convert: ${heicErr.message})`);
    }
  }
}

async function writeOutputFile(auth, folderId, filename, content) {
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.create({
    requestBody: { name: filename, parents: [folderId], mimeType: 'text/plain' },
    supportsAllDrives: true,
    media: { mimeType: 'text/plain', body: Readable.from([content]) },
  });
}

async function uploadFile(auth, folderId, filename, mimeType, buffer) {
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.create({
    requestBody: { name: filename, parents: [folderId], mimeType },
    supportsAllDrives: true,
    media: { mimeType, body: Readable.from([buffer]) },
  });
}

module.exports = { folderIdFromUrl, listPhotos, downloadPhotoAsBase64, downloadPhotoThumb, downloadPhotoBuffer, writeOutputFile, uploadFile, getOrCreateSubfolder };
