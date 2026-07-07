jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: {
    create: jest.fn().mockResolvedValue({
      content: [{
        text: `SELECTED PHOTOS
1: Great before/after showing roof quality
2: Shows the crew working professionally

SCRIPT
San Antonio homeowners trust this crew to get it done right the first time. Full replacement in one day — clean and built to last.

HIGGSFIELD PROMPT
Cinematic slow pan across a newly installed shingle roof, golden hour light. Camera pulls back to reveal satisfied homeowner.

MIDJOURNEY PROMPT
Professional roofing crew on a residential Texas home, golden hour, photorealistic --ar 9:16 --style raw`,
      }],
    }),
  },
})));

const { selectPhotosAndGeneratePlan } = require('../lib/media-prompt');

const client = { name: 'ABC Roofing', business_type: 'Roofing', location: 'San Antonio, TX', brand_voice: 'Direct' };
const photos = [
  { id: 'p1', name: 'before.jpg', data: 'base64data1', mimeType: 'image/jpeg' },
  { id: 'p2', name: 'after.jpg', data: 'base64data2', mimeType: 'image/jpeg' },
];

test('returns selectedPhotos, script, higgsfieldPrompt, midjourneyPrompt', async () => {
  const plan = await selectPhotosAndGeneratePlan(client, photos);
  expect(plan.selectedPhotos).toHaveLength(2);
  expect(plan.selectedPhotos[0]).toMatchObject({ id: 'p1', name: 'before.jpg' });
  expect(plan.selectedPhotos[0].reason).toBeTruthy();
  expect(plan.script).toContain('San Antonio');
  expect(plan.higgsfieldPrompt).toContain('Cinematic');
  expect(plan.midjourneyPrompt).toContain('--ar 9:16');
});
