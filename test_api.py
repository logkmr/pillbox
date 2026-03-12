import httpx
import asyncio
from urllib.parse import quote

async def test_mobile_api():
    cis = "0460702494443919vO37mX" # Example CIS, might be invalid but let's see the response
    url = f"https://mobile.api.crpt.ru/mobile/check?cis={quote(cis, safe='')}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            print(f"Requesting {url}...")
            response = await client.get(url, headers=headers)
            print(f"Status: {response.status_code}")
            print(f"Response: {response.text[:200]}...")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_mobile_api())
