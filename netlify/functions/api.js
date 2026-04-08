
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

      console.log(`Checking code: ${text}`);

      // ── Попытка 1: CDN API (актуальный публичный эндпоинт, работает без авторизации) ──
      try {
        const cdnResponse = await fetch('https://cdn01.crpt.ru/api/v4/true-api/cises/short/list', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ cises: [text] })
        });

        if (cdnResponse.ok) {
          const cdnData = await cdnResponse.json();
          const codeInfo = cdnData.codes?.[0];

          if (codeInfo && codeInfo.found) {
            // Форматируем дату из ISO в ДД.ММ.ГГГГ
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
              body: JSON.stringify({ success: true, cis: text, data: normalizedData })
            };
          }
          console.log(`[CDN API] Code not found in response`);
        } else {
          console.log(`[CDN API] Non-OK response: ${cdnResponse.status}`);
        }
      } catch (cdnErr) {
        console.log(`[CDN API] Failed: ${cdnErr.message}`);
      }

      // ── Попытка 2: mobile.api.crpt.ru (старый эндпоинт, как запасной) ──
      try {
        const mobileUrl = `https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(text)}`;
        const mobileResponse = await fetch(mobileUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
            'Accept': 'application/json'
          }
        });

        if (mobileResponse.ok) {
          const mobileData = await mobileResponse.json();
          console.log(`[Mobile API] Success`);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, cis: text, data: mobileData })
          };
        } else {
          console.log(`[Mobile API] Non-OK response: ${mobileResponse.status}`);
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
      console.error('Error in scan-text:', error);
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
