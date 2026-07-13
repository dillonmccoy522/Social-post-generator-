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

test('createClient accepts and stores source_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Drive Test',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    source_drive_folder_id: 'abc123',
  });
  expect(client.source_drive_folder_id).toBe('abc123');
  expect(client.output_drive_folder_id).toBeNull();
});

test('createClient defaults source_drive_folder_id to null when omitted', () => {
  const client = db.createClient({
    name: 'No Drive',
    business_type: 'HVAC',
    location: 'Austin, TX',
  });
  expect(client.source_drive_folder_id).toBeNull();
});

test('updateClient updates source_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Update Me',
    business_type: 'Roofing',
    location: 'Dallas, TX',
  });
  const updated = db.updateClient(client.id, {
    name: 'Update Me',
    business_type: 'Roofing',
    location: 'Dallas, TX',
    brand_voice: '',
    source_drive_folder_id: 'xyz789',
  });
  expect(updated.source_drive_folder_id).toBe('xyz789');
});

test('setClientOutputFolder sets output_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Output Test',
    business_type: 'Detailing',
    location: 'Houston, TX',
  });
  const updated = db.setClientOutputFolder(client.id, 'output-folder-id');
  expect(updated.output_drive_folder_id).toBe('output-folder-id');
  expect(updated.id).toBe(client.id);
});

test('createClient accepts and stores output_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Output Store',
    business_type: 'Roofing',
    location: 'San Antonio, TX',
    output_drive_folder_id: 'out123',
  });
  expect(client.output_drive_folder_id).toBe('out123');
});

test('createClient defaults output_drive_folder_id to null when omitted', () => {
  const client = db.createClient({
    name: 'No Output',
    business_type: 'HVAC',
    location: 'Austin, TX',
  });
  expect(client.output_drive_folder_id).toBeNull();
});

test('updateClient updates output_drive_folder_id', () => {
  const client = db.createClient({
    name: 'Up Output',
    business_type: 'Roofing',
    location: 'Dallas, TX',
  });
  const updated = db.updateClient(client.id, {
    name: 'Up Output',
    business_type: 'Roofing',
    location: 'Dallas, TX',
    brand_voice: '',
    source_drive_folder_id: null,
    output_drive_folder_id: 'newout',
  });
  expect(updated.output_drive_folder_id).toBe('newout');
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
