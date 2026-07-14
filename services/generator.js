// The generation pipeline: takes a queued asset, generates it via Higgsfield,
// uploads the result to the client's send-to Drive folder, and records the outcome.
// Status flow: queued -> generating -> draft (success) | failed (error).

const db = require('../database');
const higgsfield = require('./higgsfield');
const drive = require('./drive');

function safeName(str) {
  return String(str || 'asset').replace(/[^\w-]+/g, '_').slice(0, 60);
}

// Process a single asset by id. Never throws — records failure on the asset instead.
async function processAsset(id) {
  const asset = db.getAssetById(id);
  if (!asset) return;

  db.updateAsset(id, { status: 'generating', error: null });

  try {
    const { url, thumbUrl, jobId } = await higgsfield.generateImage(asset.prompt);

    let outputUrl = url;
    let driveFileId = null;

    const client = db.getClientById(asset.client_id);
    if (drive.isConfigured() && client && client.output_drive_folder_id) {
      try {
        const filename = `${safeName(client.name)}_${id}.png`;
        const uploaded = await drive.uploadToFolder(url, filename, client.output_drive_folder_id);
        driveFileId = uploaded.id || null;
        if (uploaded.webViewLink) outputUrl = uploaded.webViewLink;
      } catch (e) {
        // Drive upload is non-fatal — keep the Higgsfield URL so the asset still succeeds.
        console.error('Drive upload failed for asset', id, e.message);
      }
    }

    db.updateAsset(id, {
      status: 'draft',
      output_drive_url: outputUrl,
      thumbnail_url: thumbUrl,
      output_drive_file_id: driveFileId,
      higgsfield_job_id: jobId || null,
      error: null,
    });
  } catch (err) {
    db.updateAsset(id, { status: 'failed', error: err.message });
  }
}

module.exports = { processAsset };
