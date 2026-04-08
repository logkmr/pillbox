
export const handler = async (event, context) => {
  const fullPath = event.path || '';
  const path = fullPath.toLowerCase().replace(/^.*?\/(api|functions\/api)/, '');

  console.log(`[Function] Method: ${event.httpMethod}, FullPath: ${fullPath}, CleanPath: ${path}`);

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
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'No text provided' })
        };
      }

      // Если QR-код содержит URL — извлекаем CIS из параметра
      let cis = text.trim();
      try {
        const urlObj = new URL(cis);
        const cisParam = urlObj.searchParams.get('cis');
        if (cisParam) {
          cis = cisParam;
          console.log(`[Function] Extracted CIS from URL: ${cis}`);
        }
      } catch {
        // Не URL — используем как есть
      }

      console.log(`[Function] Checking CIS: ${cis}`);

      const mobileHeaders = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36',
        'Accept': 'application/json'
      };

      // ── Попытка 1: CDN API ──
      try {
        const cdnResponse = await fetch('https://cdn01.crpt.ru/api/v4/true-api/cises/short/list', {
          method: 'POST',
          headers: { ...mobileHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ cises: [cis] })
        });

        console.log(`[CDN API] Status: ${cdnResponse.status}`);

        if (cdnResponse.ok) {
          const cdnData = await cdnResponse.json();
          const codeInfo = cdnData.codes?.[0];

          if (codeInfo && codeInfo.found) {
            let expDate = '—';
            if (codeInfo.expireDate) {
              const d = new Date(codeInfo.expireDate);
              expDate = [
                String(d.getDate()).padStart(2, '0'),
                String(d.getMonth() + 1).padStart(2, '0'),
                d.getFullYear()
              ].join('.');
            }

            const normalizedData = {
              productName: codeInfo.productName || `Лекарство (GTIN: ${codeInfo.gtin || '?'})`,
              expDate,
              gtin: codeInfo.gtin,
              batch: codeInfo.batch || '—',
              status: codeInfo.utilised ? 'INTRODUCED' : 'EMITTED',
              valid: codeInfo.valid,
              found: codeInfo.found,
              source: 'cdn'
            };

            console.log(`[CDN API] Found: gtin=${normalizedData.gtin}, exp=${normalizedData.expDate}`);
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({ success: true, cis, data: normalizedData })
            };
          }
          console.log(`[CDN API] Code not found in response`);
        } else {
          const errText = await cdnResponse.text().catch(() => '');
          console.log(`[CDN API] Non-OK: ${cdnResponse.status} — ${errText.slice(0, 200)}`);
        }
      } catch (cdnErr) {
        console.log(`[CDN API] Failed: ${cdnErr.message}`);
      }

      // ── Попытка 2: mobile.api.crpt.ru ──
      try {
        const mobileUrl = `https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(cis)}`;
        const mobileResponse = await fetch(mobileUrl, { headers: mobileHeaders });

        console.log(`[Mobile API] Status: ${mobileResponse.status}`);

        if (mobileResponse.ok) {
          const mobileData = await mobileResponse.json();
          console.log(`[Mobile API] Success`);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, cis, data: mobileData })
          };
        } else {
          const errText = await mobileResponse.text().catch(() => '');
          console.log(`[Mobile API] Non-OK: ${mobileResponse.status} — ${errText.slice(0, 200)}`);
        }
      } catch (mobileErr) {
        console.log(`[Mobile API] Failed: ${mobileErr.message}`);
      }

      // ── Оба API недоступны ──
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

  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'Not Found' })
  };
};
