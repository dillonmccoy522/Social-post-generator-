process.env.DB_PATH = ':memory:';
const db = require('../database');

afterEach(() => {
  db.closeDb();
});

test('createClient and getClientById', () => {
  const client = db.createClient({
    name: 'Test Roofing',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    brand_voice: 'Friendly and direct',
  });
  expect(client.id).toBeDefined();
  expect(client.name).toBe('Test Roofing');
  expect(client.last_pillar).toBeNull();

  const fetched = db.getClientById(client.id);
  expect(fetched.name).toBe('Test Roofing');
});

test('updateClient', () => {
  const client = db.createClient({
    name: 'Old Name',
    business_type: 'Roofing',
    location: 'Austin, TX',
    brand_voice: '',
  });
  const updated = db.updateClient(client.id, {
    name: 'New Name',
    business_type: 'Roofing',
    location: 'Austin, TX',
    brand_voice: 'Bold',
  });
  expect(updated.name).toBe('New Name');
  expect(updated.brand_voice).toBe('Bold');
});

test('deleteClient', () => {
  const client = db.createClient({
    name: 'Delete Me',
    business_type: 'HVAC',
    location: 'Dallas, TX',
  });
  db.deleteClient(client.id);
  expect(db.getClientById(client.id)).toBeUndefined();
});

test('updateClientLastPillar', () => {
  const client = db.createClient({
    name: 'Pillar Test',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  db.updateClientLastPillar(client.id, 'Job Showcase');
  const updated = db.getClientById(client.id);
  expect(updated.last_pillar).toBe('Job Showcase');
});

test('createPost and getPostsByClientId', () => {
  const client = db.createClient({
    name: 'Post Test',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  const post = db.createPost({
    clientId: client.id,
    weekOf: '2026-07-05',
    photoDescriptions: JSON.stringify(['photo1', 'photo2', 'photo3']),
    generatedContent: 'POST 1 — Job Showcase\nCaption: Test caption',
  });
  expect(post.id).toBeDefined();
  expect(post.client_id).toBe(client.id);

  const posts = db.getPostsByClientId(client.id);
  expect(posts).toHaveLength(1);
  expect(posts[0].week_of).toBe('2026-07-05');
});

test('getAllPosts joins client name', () => {
  const client = db.createClient({
    name: 'All Posts Client',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
  });
  db.createPost({
    clientId: client.id,
    weekOf: '2026-07-05',
    photoDescriptions: '[]',
    generatedContent: 'content',
  });
  const all = db.getAllPosts();
  expect(all[0].client_name).toBe('All Posts Client');
});

describe('media jobs', () => {
  let clientId;

  beforeEach(() => {
    const client = db.createClient({
      name: 'Test Media Client',
      business_type: 'Roofing',
      location: 'San Antonio, TX',
    });
    clientId = client.id;
  });

  test('clients table has drive_photos_url and drive_output_url columns', () => {
    const client = db.getClientById(clientId);
    expect(client).toHaveProperty('drive_photos_url');
    expect(client).toHaveProperty('drive_output_url');
  });

  test('createMediaJob saves and returns a job', () => {
    const job = db.createMediaJob({
      clientId,
      selectedPhotos: JSON.stringify([{ id: 'abc', name: 'photo1.jpg', reason: 'great shot' }]),
      script: 'Test script',
      higgsfieldPrompt: 'Test video prompt',
      midjourneyPrompt: 'Test image prompt',
    });
    expect(job.id).toBeDefined();
    expect(job.client_id).toBe(clientId);
    expect(job.script).toBe('Test script');
  });

  test('getMediaJobsByClientId returns jobs for that client', () => {
    db.createMediaJob({
      clientId,
      selectedPhotos: '[]',
      script: 'Script A',
      higgsfieldPrompt: 'Video A',
      midjourneyPrompt: 'Image A',
    });
    const jobs = db.getMediaJobsByClientId(clientId);
    expect(jobs.length).toBe(1);
    expect(jobs[0].script).toBe('Script A');
  });

  test('getUsedPhotoIds returns all photo IDs used for a client', () => {
    db.createMediaJob({
      clientId,
      selectedPhotos: JSON.stringify([{ id: 'photo-1' }, { id: 'photo-2' }]),
      script: 'S',
      higgsfieldPrompt: 'H',
      midjourneyPrompt: 'M',
    });
    const ids = db.getUsedPhotoIds(clientId);
    expect(ids).toContain('photo-1');
    expect(ids).toContain('photo-2');
  });
});
