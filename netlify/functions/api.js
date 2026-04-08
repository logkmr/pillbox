
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

// ── CDN API ──
const tryCdnApi = async (cis) => {
  const res = await fetchWithTimeout('https://cdn01.crpt.ru/api/v4/true-api/cises/short/list', {
    method: 'POST',
    headers: { ...mobileHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cises: [cis] })
  });
  console.log(`[CDN] ${res.status}`);
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
    expDate,
    gtin: info.gtin,
    batch: info.batch || '—',
    status: info.utilised ? 'INTRODUCED' : 'EMITTED',
    found: true,
    source: 'cdn'
  };
};

// ── Mobile API (прямой) ──
const tryMobileApi = async (cis) => {
  const res = await fetchWithTimeout(
    `https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(cis)}`,
    { headers: mobileHeaders }
  );
  console.log(`[Mobile] ${res.status}`);
  if (!res.ok) return null;
  return { ...(await res.json()), source: 'mobile' };
};

// ── Прокси через allorigins.win ──
const tryProxyMobileApi = async (cis) => {
  const target = `https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(cis)}`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(target)}`;
  const res = await fetchWithTimeout(proxyUrl);
  console.log(`[Proxy] ${res.status}`);
  if (!res.ok) return null;

  const wrapper = await res.json();
  if (!wrapper.contents) return null;

  const inner = JSON.parse(wrapper.contents);
  return { ...inner, source: 'proxy' };
};

// ── Прокси через corsproxy.io ──
const tryCorsproxy = async (cis) => {
  const target = `https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(cis)}`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(target)}`;
  const res = await fetchWithTimeout(proxyUrl, { headers: mobileHeaders });
  console.log(`[Corsproxy] ${res.status}`);
  if (!res.ok) return null;
  return { ...(await res.json()), source: 'corsproxy' };
};

export const handler = async (event, context) => {
  const fullPath = event.path || '';
  const path = fullPath.toLowerCase().replace(/^.*?\/(api|functions\/api)/, '');

  console.log(`[Function] ${event.httpMethod} ${path}`);

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if ((path === '/scan-text' || path === 'scan-text') && event.httpMethod === 'POST') {
    try {
      const { text } = JSON.parse(event.body);
      if (!text) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'No text provided' }) };
      }

      // Извлечь CIS из URL-формата (https://честныйзнак.рф/...?cis=01...)
      let cis = text.trim();
      try {
        const urlObj = new URL(cis);
        const cisParam = urlObj.searchParams.get('cis');
        if (cisParam) {
          cis = cisParam;
          console.log(`[Function] CIS extracted from URL`);
        }
      } catch { /* не URL */ }

      console.log(`[Function] CIS: ${cis.slice(0, 40)}...`);

      const attempts = [
        ['CDN', tryCdnApi],
        ['Mobile', tryMobileApi],
        ['Proxy(allorigins)', tryProxyMobileApi],
        ['Proxy(corsproxy)', tryCorsproxy],
      ];

      for (const [name, fn] of attempts) {
        try {
          const data = await fn(cis);
          if (data) {
            console.log(`[Function] Success via ${name}`);
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({ success: true, cis, data })
            };
          }
        } catch (e) {
          console.log(`[${name}] Error: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
        }
      }

      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Сервисы Честного знака временно недоступны. Попробуйте позже или добавьте лекарство вручную.'
        })
      };

    } catch (error) {
      console.error('[Function] Unexpected error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: error.message })
      };
    }
  }

  // Геолокация клиента — читаем заголовок x-country, который Netlify CDN проставляет сам
  if ((path === '/geo' || path === 'geo') && event.httpMethod === 'GET') {
    const country = (event.headers['x-country'] || 'UNKNOWN').toUpperCase();
    console.log(`[Geo] x-country=${country}, x-forwarded-for=${event.headers['x-forwarded-for']}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ country })
    };
  }

  if ((path === '/scan' || path === 'scan') && event.httpMethod === 'POST') {
    return {
      statusCode: 501,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Серверное распознавание фото временно недоступно на Netlify. Используйте камеру или локальное распознавание.'
      })
    };
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not Found' }) };
};
