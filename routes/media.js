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

        const BANNER_H    = S(240);
        const LOGO_SECT_W = S(270);
        const PAD         = S(24);
        const QR_SIZE     = S(160);
        const ACCENT_H    = S(6);

        const logoBuffer = await sharp(logoRaw)
          .resize(LOGO_SECT_W - S(40), BANNER_H - S(40), { fit: 'inside' })
          .toBuffer();
        const logoMeta = await sharp(logoBuffer).metadata();
        const qrBuffer = qrRaw ? await sharp(qrRaw).resize(QR_SIZE, QR_SIZE).toBuffer() : null;

        const TEXT_X = LOGO_SECT_W + S(30);
        const qrLeft = W - QR_SIZE - PAD;

        // Smart placement — pick the strip that is less visually busy
        const checkH = Math.min(BANNER_H, Math.floor(H / 2));
        const [topStats, botStats] = await Promise.all([
          sharp(photoBuffer).extract({ left: 0, top: 0, width: W, height: checkH }).stats(),
          sharp(photoBuffer).extract({ left: 0, top: H - checkH, width: W, height: checkH }).stats(),
        ]);
        const topBusy = topStats.channels.reduce((s, c) => s + c.stdev, 0);
        const botBusy = botStats.channels.reduce((s, c) => s + c.stdev, 0);
        const bannerTop = topBusy <= botBusy ? 0 : H - BANNER_H;
        const accentY   = bannerTop === 0 ? 0 : bannerTop + BANNER_H - ACCENT_H;

        // Row positions inside the banner
        const R1 = bannerTop + S(58);   // business name
        const R2 = bannerTop + S(90);   // website
        const R3 = bannerTop + S(140);  // phone (hero)
        const R4 = bannerTop + S(175);  // social row 1 (instagram)
        const R5 = bannerTop + S(203);  // social row 2 (facebook)
        const iconSize   = S(18);
        const socialSize = S(15);

        const igHandle = client.instagram ? '@' + getHandle(client.instagram) : null;
        const fbHandle = client.facebook  ? '@' + getHandle(client.facebook)  : null;

        // Build social rows — stacked vertically
        const socialSvg = [];
        if (igHandle) {
          const iconTop = R4 - iconSize + S(3);
          socialSvg.push(
            `<rect x="${TEXT_X}" y="${iconTop}" width="${iconSize}" height="${iconSize}" rx="${S(4)}" fill="url(#ig-grad)"/>`,
            `<circle cx="${TEXT_X + iconSize/2}" cy="${iconTop + iconSize/2}" r="${S(5.5)}" stroke="white" stroke-width="${S(2)}" fill="none"/>`,
            `<circle cx="${TEXT_X + iconSize - S(4)}" cy="${iconTop + S(4)}" r="${S(1.5)}" fill="white"/>`,
            `<text x="${TEXT_X + iconSize + S(7)}" y="${R4}" fill="#BBBBBB" font-size="${socialSize}" font-family="Arial,Helvetica,sans-serif">${escXml(igHandle)}</text>`,
          );
        }
        if (fbHandle) {
          const fbY = igHandle ? R5 : R4;
          const iconTop = fbY - iconSize + S(3);
          socialSvg.push(
            `<rect x="${TEXT_X}" y="${iconTop}" width="${iconSize}" height="${iconSize}" rx="${S(4)}" fill="#1877F2"/>`,
            `<text x="${TEXT_X + S(5)}" y="${fbY - S(1)}" fill="white" font-size="${S(14)}" font-weight="bold" font-family="Arial,Helvetica,sans-serif">f</text>`,
            `<text x="${TEXT_X + iconSize + S(7)}" y="${fbY}" fill="#BBBBBB" font-size="${socialSize}" font-family="Arial,Helvetica,sans-serif">${escXml(fbHandle)}</text>`,
          );
        }

        // Full-photo SVG (W×H transparent except banner) — avoids composite bounds error
        const svgOverlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#f09433"/>
              <stop offset="50%" stop-color="#e1306c"/>
              <stop offset="100%" stop-color="#833ab4"/>
            </linearGradient>
          </defs>
          <rect x="0" y="${bannerTop}" width="${LOGO_SECT_W}" height="${BANNER_H}" fill="#FFFFFF"/>
          <rect x="${LOGO_SECT_W}" y="${bannerTop}" width="${W - LOGO_SECT_W}" height="${BANNER_H}" fill="#111111"/>
          <rect x="0" y="${accentY}" width="${W}" height="${ACCENT_H}" fill="#C84B31"/>
          ${client.name    ? `<text x="${TEXT_X}" y="${R1}" fill="#FFFFFF" font-size="${S(26)}" font-weight="700" font-family="Arial,Helvetica,sans-serif">${escXml(client.name)}</text>` : ''}
          ${client.website ? `<text x="${TEXT_X}" y="${R2}" fill="#E2C97E" font-size="${S(16)}" font-family="Arial,Helvetica,sans-serif">${escXml(client.website)}</text>` : ''}
          ${client.phone   ? `<text x="${TEXT_X}" y="${R3}" fill="#FFFFFF" font-size="${S(30)}" font-weight="700" font-family="Arial,Helvetica,sans-serif">${escXml(client.phone)}</text>` : ''}
          ${socialSvg.join('\n          ')}
          ${qrBuffer ? `<text x="${qrLeft + QR_SIZE / 2}" y="${bannerTop + BANNER_H - S(8)}" fill="#555555" font-size="${S(11)}" font-family="Arial,Helvetica,sans-serif" text-anchor="middle">Scan for Reviews</text>` : ''}
        </svg>`;

        const logoLeft = Math.round((LOGO_SECT_W - logoMeta.width)  / 2);
        const logoTop  = bannerTop + Math.round((BANNER_H - logoMeta.height) / 2);
        const qrTop    = bannerTop + Math.round((BANNER_H - QR_SIZE) / 2);

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
