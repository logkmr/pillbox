
export const handler = async (event, context) => {
  const path = event.path.replace('/.netlify/functions/api', '');
  
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Роут для получения инфо по тексту (коду)
  if (path === '/scan-text' && event.httpMethod === 'POST') {
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
      
      const url = `https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(text)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`CRPT API error: ${response.status}`);
      }

      const data = await response.json();
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, cis: text, data })
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

  // Роут для сканирования изображения (заглушка или легкая реализация)
  if (path === '/scan' && event.httpMethod === 'POST') {
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
