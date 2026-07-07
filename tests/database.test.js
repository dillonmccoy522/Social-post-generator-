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
