process.env.DB_PATH = ':memory:';
const db = require('../database');

afterEach(() => db.closeDb());

function makeClient() {
  return db.createClient({ name: 'Acme Roofing', business_type: 'Roofing', location: 'SA, TX', brand_voice: '' });
}

test('createAsset inserts with defaults', () => {
  const c = makeClient();
  const a = db.createAsset({ client_id: c.id, type: 'image', prompt: 'roof hero shot' });
  expect(a.id).toBeDefined();
  expect(a.status).toBe('draft');
  expect(a.campaign).toBe('');
});

test('getAssets filters by clientId, status, campaign', () => {
  const c = makeClient();
  db.createAsset({ client_id: c.id, type: 'image', status: 'queued', campaign: 'summer' });
  db.createAsset({ client_id: c.id, type: 'video', status: 'approved', campaign: 'summer' });
  expect(db.getAssets({})).toHaveLength(2);
  expect(db.getAssets({ status: 'queued' })).toHaveLength(1);
  expect(db.getAssets({ campaign: 'summer', status: 'approved' })[0].type).toBe('video');
  expect(db.getAssets({ clientId: c.id })[0].client_name).toBe('Acme Roofing');
});

test('updateAsset updates allowed fields only', () => {
  const c = makeClient();
  const a = db.createAsset({ client_id: c.id, type: 'image' });
  const updated = db.updateAsset(a.id, { status: 'approved', thumbnail_url: 'https://x/y.jpg', bogus: 'ignored' });
  expect(updated.status).toBe('approved');
  expect(updated.thumbnail_url).toBe('https://x/y.jpg');
  expect(updated.bogus).toBeUndefined();
});

test('deleteAsset removes row; cascade on client delete', () => {
  const c = makeClient();
  const a = db.createAsset({ client_id: c.id, type: 'image' });
  db.deleteAsset(a.id);
  expect(db.getAssetById(a.id)).toBeUndefined();
  const b = db.createAsset({ client_id: c.id, type: 'image' });
  db.deleteClient(c.id);
  expect(db.getAssetById(b.id)).toBeUndefined();
});
