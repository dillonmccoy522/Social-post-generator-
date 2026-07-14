// Thin wrapper around the Higgsfield platform SDK for image generation.
// Credentials come from HIGGSFIELD_API_KEY / HIGGSFIELD_API_SECRET (.env).

function isConfigured() {
  return !!(process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_SECRET);
}

// Text-to-image generation. Returns { url, thumbUrl, jobId }.
// Throws on auth/credit/generation failures so the caller can mark the asset failed.
async function generateImage(prompt, aspectRatio = '4:5') {
  if (!prompt) throw new Error('A prompt is required to generate an image');
  const { createHiggsfieldClient } = await import('@higgsfield/client/v2');
  const client = createHiggsfieldClient({
    credentials: `${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_API_SECRET}`,
  });

  const jobSet = await client.subscribe('flux-pro/kontext/max/text-to-image', {
    input: { aspect_ratio: aspectRatio, prompt, safety_tolerance: 2 },
    withPolling: true,
  });

  if (!jobSet.isCompleted) {
    throw new Error(`Generation did not complete (status: ${jobSet.status || 'unknown'})`);
  }
  const job = jobSet.jobs && jobSet.jobs[0];
  const url = job && job.results && job.results.raw && job.results.raw.url;
  if (!url) throw new Error('Generation completed but returned no image URL');
  const thumbUrl = (job.results.min && job.results.min.url) || url;
  return { url, thumbUrl, jobId: jobSet.id };
}

module.exports = { isConfigured, generateImage };
