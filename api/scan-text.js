const TIMEOUT_MS = 5000;

const fetchWithTimeout = (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

const mobileHeaders = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36',
  'Accept': 'application/json'
};

const tryCdnApi = async (cis) => {
  const res = await fetchWithTimeout('https://cdn01.crpt.ru/api/v4/true-api/cises/short/list', {
    method: 'POST',
    headers: { ...mobileHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cises: [cis] })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const info = data.codes?.[0];
  if (!info?.found) return null;

  let expDate = '—';
  if (info.expireDate) {
    const d = new Date(info.expireDate);
    expDate = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  }
  return {
    productName: info.productName || `Лекарство (GTIN: ${info.gtin || '?'})`,
    expDate, gtin: info.gtin, batch: info.batch || '—',
    status: info.utilised ? 'INTRODUCED' : 'EMITTED', found: true, source: 'cdn'
  };
};

const tryMobileApi = async (cis) => {
  const res = await fetchWithTimeout(
    `https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(cis)}`,
    { headers: mobileHeaders }
  );
  if (!res.ok) return null;
  return { ...(await res.json()), source: 'mobile' };
};

const tryProxyMobileApi = async (cis) => {
  const target = `https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(cis)}`;
  const res = await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(target)}`);
  if (!res.ok) return null;
  const wrapper = await res.json();
  if (!wrapper.contents) return null;
  return { ...JSON.parse(wrapper.contents), source: 'proxy' };
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ success: false, error: 'No text provided' });

  let cis = text.trim();
  try {
    const urlObj = new URL(cis);
    const cisParam = urlObj.searchParams.get('cis');
    if (cisParam) cis = cisParam;
  } catch { /* не URL */ }

  const attempts = [tryCdnApi, tryMobileApi, tryProxyMobileApi];
  for (const fn of attempts) {
    try {
      const data = await fn(cis);
      if (data) return res.status(200).json({ success: true, cis, data });
    } catch (e) {
      console.log(`Attempt failed: ${e.message}`);
    }
  }

  return res.status(503).json({
    success: false,
    error: 'Сервисы Честного знака временно недоступны. Попробуйте позже или добавьте лекарство вручную.'
  });
}
