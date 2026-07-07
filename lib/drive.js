const { google } = require('googleapis');
const { Readable } = require('stream');

function folderIdFromUrl(url) {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Invalid Google Drive folder URL');
  return match[1];
}

async function listPhotos(auth, folderId, usedFileIds = []) {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 50,
  });
  return (response.data.files || [])
    .filter(f => !usedFileIds.includes(f.id))
    .slice(0, 20);
}

async function downloadPhotoAsBase64(auth, fileId) {
  const drive = google.drive({ version: 'v3', auth });
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return {
    data: Buffer.from(response.data).toString('base64'),
    mimeType: response.headers['content-type'] || 'image/jpeg',
  };
}

async function writeOutputFile(auth, folderId, filename, content) {
  const drive = google.drive({ version: 'v3', auth });
  await drive.files.create({
    requestBody: { name: filename, parents: [folderId], mimeType: 'text/plain' },
    media: { mimeType: 'text/plain', body: Readable.from([content]) },
  });
}

module.exports = { folderIdFromUrl, listPhotos, downloadPhotoAsBase64, writeOutputFile };
