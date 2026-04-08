export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Vercel injecting country header automatically
  const country = (req.headers['x-vercel-ip-country'] || 'UNKNOWN').toUpperCase();
  console.log(`[Geo] x-vercel-ip-country=${country}`);

  return res.status(200).json({ country });
}
