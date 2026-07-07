jest.mock('googleapis', () => {
  const mockList = jest.fn();
  const mockGet = jest.fn();
  const mockCreate = jest.fn();
  return {
    google: {
      drive: () => ({ files: { list: mockList, get: mockGet, create: mockCreate } }),
      __mocks: { mockList, mockGet, mockCreate },
    },
  };
});

const { google } = require('googleapis');
const { mockList, mockGet, mockCreate } = google.__mocks;
const { folderIdFromUrl, listPhotos, downloadPhotoAsBase64, writeOutputFile } = require('../lib/drive');

describe('folderIdFromUrl', () => {
  test('extracts folder ID from Drive URL', () => {
    expect(folderIdFromUrl('https://drive.google.com/drive/folders/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs'))
      .toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs');
  });
  test('throws on invalid URL', () => {
    expect(() => folderIdFromUrl('https://google.com')).toThrow('Invalid Google Drive folder URL');
  });
});

describe('listPhotos', () => {
  test('excludes used IDs and returns remaining', async () => {
    mockList.mockResolvedValue({
      data: { files: [
        { id: 'img1', name: 'a.jpg', mimeType: 'image/jpeg', modifiedTime: '2026-01-01' },
        { id: 'img2', name: 'b.png', mimeType: 'image/png', modifiedTime: '2026-01-02' },
      ]},
    });
    const result = await listPhotos({}, 'folder123', ['img1']);
    expect(result.map(f => f.id)).toEqual(['img2']);
  });

  test('caps results at 20', async () => {
    mockList.mockResolvedValue({
      data: { files: Array.from({ length: 30 }, (_, i) => ({ id: `img${i}`, name: `p${i}.jpg`, mimeType: 'image/jpeg', modifiedTime: '2026-01-01' })) },
    });
    expect((await listPhotos({}, 'folder123', [])).length).toBe(20);
  });
});

describe('downloadPhotoAsBase64', () => {
  test('returns base64 string and mimeType', async () => {
    mockGet.mockResolvedValue({ data: Buffer.from('fake').buffer, headers: { 'content-type': 'image/jpeg' } });
    const result = await downloadPhotoAsBase64({}, 'file123');
    expect(result.mimeType).toBe('image/jpeg');
    expect(typeof result.data).toBe('string');
  });
});

describe('writeOutputFile', () => {
  test('calls drive.files.create with correct name and parent', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'new-file' } });
    await writeOutputFile({}, 'folder123', 'output.txt', 'Hello');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ name: 'output.txt', parents: ['folder123'] }) })
    );
  });
});
