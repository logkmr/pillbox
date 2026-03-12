from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
import asyncio
import importlib.util
import sys

# Добавляем корневую директорию в путь, чтобы импортировать логику
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Пытаемся импортировать функции из основного скрипта
try:
    from chestniy_znak import decode_from_image, get_product_info, STATUS_MAP, LABELS
except ImportError:
    # Если не получается импортировать напрямую, подгрузим модуль по пути
    spec = importlib.util.spec_from_file_location("chestniy_znak", "../chestniy_znak.py")
    cz = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cz)
    decode_from_image = cz.decode_from_image
    get_product_info = cz.get_product_info
    STATUS_MAP = cz.STATUS_MAP
    LABELS = cz.LABELS

app = FastAPI()

# Разрешаем CORS для фронтенда
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/scan")
async def scan_product(file: UploadFile = File(...)):
    # ... (код остается прежним)
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    try:
        cis = decode_from_image(file_path)
        data = await get_product_info(cis)
        return {"success": True, "cis": cis, "data": data}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@app.post("/scan-text")
async def scan_text(payload: dict):
    text = payload.get("text")
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")
    
    try:
        # Сразу запрашиваем инфо по тексту (коду)
        data = await get_product_info(text)
        return {
            "success": True,
            "cis": text,
            "data": data
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
