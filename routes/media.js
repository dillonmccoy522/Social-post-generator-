const express = require('express');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const QRCode = require('qrcode');
const router = express.Router();

function escXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const { requireAuth } = require('../lib/google-auth');
const { downloadPhotoAsBase64, downloadPhotoBuffer, writeOutputFile, uploadFile, folderIdFromUrl, getOrCreateSubfolder } = require('../lib/drive');
const { selectPhotosAndGeneratePlan } = require('../lib/media-prompt');
const db = require('../database');

function getWeekFolder() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

router.post('/generate', requireAuth, async (req, res) => {
  const { clientId, photos } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });
  if (!photos || !Array.isArray(photos) || photos.length === 0) return res.status(400).json({ error: 'photos array is required' });
  const client = db.getClientById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  try {
    const results = await Promise.allSettled(
      photos.slice(0, 5).map(async (photo) => {
        const { data, mimeType } = await downloadPhotoAsBase64(req.googleAuth, photo.id);
        return { ...photo, data, mimeType };
      })
    );
    const photosWithData = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
    const plan = await selectPhotosAndGeneratePlan(client, photosWithData);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save', requireAuth, async (req, res) => {
  const { clientId, plan } = req.body;
  if (!clientId || !plan) return res.status(400).json({ error: 'clientId and plan are required' });
  const client = db.getClientById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const job = db.createMediaJob({
    clientId,
    selectedPhotos: JSON.stringify(plan.selectedPhotos || []),
    script: plan.script || '',
    higgsfieldPrompt: plan.higgsfieldPrompt || '',
    midjourneyPrompt: plan.midjourneyPrompt || '',
  });

  if (client.drive_output_url) {
    try {
      const folderId = folderIdFromUrl(client.drive_output_url);
      const date = new Date().toISOString().split('T')[0];
      const content = [
        `Niewdel Media Plan — ${client.name} — ${date}`,
        '', 'MARKETING SCRIPT', plan.script,
        '', 'HIGGSFIELD VIDEO PROMPT', plan.higgsfieldPrompt,
        '', 'MIDJOURNEY IMAGE PROMPT', plan.midjourneyPrompt,
        '', 'SELECTED PHOTOS',
        ...(plan.selectedPhotos || []).map(p => `- ${p.name}: ${p.reason}`),
      ].join('\n');
      await writeOutputFile(req.googleAuth, folderId, `niewdel-media-${date}.txt`, content);
    } catch (err) {
      console.error('Drive output write failed:', err.message);
    }
  }
  res.json({ job });
});

router.post('/brand', requireAuth, async (req, res) => {
  const { clientId, photos } = req.body;
  if (!clientId || !Array.isArray(photos) || photos.length === 0)
    return res.status(400).json({ error: 'clientId and photos array are required' });
  const client = db.getClientById(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!client.drive_output_url) return res.status(400).json({ error: 'Client has no output folder configured' });

  try {
    const folderId = folderIdFromUrl(client.drive_output_url);
    const weekFolder = getWeekFolder();
    const weekFolderId = await getOrCreateSubfolder(req.googleAuth, folderId, weekFolder);

    const logoRaw = fs.readFileSync(path.join(__dirname, '..', 'public', 'logo-pbr.png'));
    let qrRaw = null;
    if (client.gmb_url) {
      qrRaw = await QRCode.toBuffer(client.gmb_url, {
        width: 500, margin: 1,
        color: { dark: '#FFFFFF', light: '#00000000' },
        type: 'png',
      });
    }
    const date = new Date().toISOString().split('T')[0];
    const getHandle = u => { try { return new URL(u).pathname.replace(/^\/|\/$/g, '').split('/')[0]; } catch { return u; } };

    const results = await Promise.allSettled(
      photos.map(async (photo) => {
        const rawBuffer = await downloadPhotoBuffer(req.googleAuth, photo.id);
        // Normalize EXIF rotation so W/H match what sharp actually composites onto
        const { data: photoBuffer, info: { width: W, height: H } } = await sharp(rawBuffer)
          .rotate()
          .toBuffer({ resolveWithObject: true });

        // proportional scaling — design baseline is 1200 px
        const scale = Math.min(W, H) / 1200;
        const S = n => Math.round(n * scale);

        const PANEL_W    = S(340);
        const PAD        = S(28);
        const LOGO_MAX_W = PANEL_W - PAD * 2;
        const LOGO_MAX_H = S(150);
        const QR_SIZE    = S(130);
        const PANEL_X    = W - PANEL_W;
        const TEXT_CX    = PANEL_X + Math.round(PANEL_W / 2);
        const GREEN      = '#87AF68';
        const iconSize   = S(28);
        const iconLeft   = PANEL_X + Math.round((PANEL_W - iconSize) / 2);

        const logoBuffer = await sharp(logoRaw)
          .resize(LOGO_MAX_W, LOGO_MAX_H, { fit: 'inside' })
          .toBuffer();
        const logoMeta = await sharp(logoBuffer).metadata();
        const qrBuffer = qrRaw ? await sharp(qrRaw).resize(QR_SIZE, QR_SIZE).toBuffer() : null;

        const DIV1_Y   = Math.round(H * 0.28);
        const DIV2_Y   = Math.round(H * 0.73);
        const logoLeft = PANEL_X + Math.round((PANEL_W - logoMeta.width) / 2);
        const logoTop  = Math.round(PAD + (DIV1_Y - PAD - logoMeta.height) / 2);
        const qrLeft   = PANEL_X + Math.round((PANEL_W - QR_SIZE) / 2);
        const qrTop    = DIV2_Y + Math.round((H - DIV2_Y - QR_SIZE - S(20)) / 2);

        const infoTop  = DIV1_Y + S(28);
        const R1       = infoTop + S(40);              // business name
        const R2       = infoTop + S(90);              // phone
        const R3       = infoTop + S(136);             // website
        const igIconY  = infoTop + S(162);             // instagram icon top
        const igTextY  = igIconY + iconSize + S(18);   // instagram handle
        const fbIconY  = igTextY + S(24);              // facebook icon top
        const fbTextY  = fbIconY + iconSize + S(18);   // facebook handle

        const igHandle = client.instagram ? '@' + getHandle(client.instagram) : null;
        const fbHandle = client.facebook  ? '@' + getHandle(client.facebook)  : null;

        const svgOverlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#f09433"/>
              <stop offset="50%" stop-color="#e1306c"/>
              <stop offset="100%" stop-color="#833ab4"/>
            </linearGradient>
          </defs>
          <rect x="${PANEL_X}" y="0" width="${PANEL_W}" height="${H}" fill="#0C0C10" opacity="0.93"/>
          <rect x="${PANEL_X}" y="0" width="${S(5)}" height="${H}" fill="${GREEN}"/>
          <rect x="${PANEL_X + PAD}" y="${DIV1_Y}" width="${PANEL_W - PAD * 2}" height="${S(1)}" fill="${GREEN}" opacity="0.35"/>
          <rect x="${PANEL_X + PAD}" y="${DIV2_Y}" width="${PANEL_W - PAD * 2}" height="${S(1)}" fill="${GREEN}" opacity="0.35"/>
          ${client.name    ? `<text x="${TEXT_CX}" y="${R1}" fill="#FFFFFF" font-size="${S(28)}" font-weight="700" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">${escXml(client.name)}</text>` : ''}
          ${client.phone   ? `<text x="${TEXT_CX}" y="${R2}" fill="${GREEN}" font-size="${S(26)}" font-weight="600" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">${escXml(client.phone)}</text>` : ''}
          ${client.website ? `<text x="${TEXT_CX}" y="${R3}" fill="#AAAAAA" font-size="${S(19)}" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">${escXml(client.website)}</text>` : ''}
          ${igHandle ? `
          <rect x="${iconLeft}" y="${igIconY}" width="${iconSize}" height="${iconSize}" rx="${S(7)}" fill="url(#ig-grad)"/>
          <circle cx="${iconLeft + iconSize / 2}" cy="${igIconY + iconSize / 2}" r="${S(8)}" stroke="white" stroke-width="${S(2)}" fill="none"/>
          <circle cx="${iconLeft + iconSize - S(7)}" cy="${igIconY + S(7)}" r="${S(2)}" fill="white"/>
          <text x="${TEXT_CX}" y="${igTextY}" fill="#AAAAAA" font-size="${S(18)}" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">${escXml(igHandle)}</text>
          ` : ''}
          ${fbHandle ? `
          <rect x="${iconLeft}" y="${fbIconY}" width="${iconSize}" height="${iconSize}" rx="${S(7)}" fill="#1877F2"/>
          <text x="${iconLeft + S(8)}" y="${fbIconY + iconSize - S(6)}" fill="white" font-size="${S(21)}" font-weight="bold" font-family="Arial,Helvetica,sans-serif">f</text>
          <text x="${TEXT_CX}" y="${fbTextY}" fill="#AAAAAA" font-size="${S(18)}" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">${escXml(fbHandle)}</text>
          ` : ''}
          ${qrBuffer ? `<text x="${qrLeft + QR_SIZE / 2}" y="${qrTop - S(8)}" fill="#4A4A4A" font-size="${S(12)}" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">Scan for Reviews</text>` : ''}
        </svg>`;

        const svgBuf = Buffer.from(svgOverlay);

        const composites = [
          { input: svgBuf,    top: 0,       left: 0       },
          { input: logoBuffer, top: logoTop, left: logoLeft },
        ];
        if (qrBuffer) composites.push({ input: qrBuffer, top: qrTop, left: qrLeft });

        // Sharp executes resize BEFORE composite internally, so overlays sized for the
        // full photo would exceed the shrunken base. Composite first, then resize separately.
        const composited = await sharp(photoBuffer)
          .composite(composites)
          .toBuffer();

        const branded = await sharp(composited)
          .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
          .toBuffer();

        const basename = (photo.name || photo.id).replace(/\.[^.]+$/, '');
        const filename = `branded-${basename}-${date}.jpg`;
        await uploadFile(req.googleAuth, weekFolderId, filename, 'image/jpeg', branded);
        return filename;
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failures  = results.filter(r => r.status === 'rejected');
    failures.forEach((r, i) => console.error(`Brand failed [photo ${i}]:`, r.reason?.message || r.reason));
    const failureReasons = failures.map(r => r.reason?.message || String(r.reason));
    res.json({ success: true, saved: succeeded.length, failed: failures.length, filenames: succeeded, weekFolder, failureReasons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history/:clientId', async (req, res) => {
  const client = db.getClientById(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json({ jobs: db.getMediaJobsByClientId(req.params.clientId) });
});

module.exports = router;
