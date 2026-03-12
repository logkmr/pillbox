import React, { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

const App = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [availableCameras, setAvailableCameras] = useState([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const codeReaderRef = useRef(null);
  const videoRef = useRef(null);

  // Динамический адрес API через прокси Vite
  const getApiUrl = (endpoint) => `/api/${endpoint}`;

  const fetchProductInfo = async (decodedText) => {
    // Чистим код от лишних символов (иногда прилетают невидимые знаки)
    const cleanText = decodedText.trim();
    if (!cleanText) return;

    setLoading(true);
    setResult(null);
    setError(null);
    stopScanner();

    try {
      const response = await fetch(getApiUrl('scan-text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText }),
      });

      const data = await response.json();
      if (data.success) {
        setResult(data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Ошибка связи: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Помощник для улучшения изображения перед распознаванием
  const processCanvas = (image, filterType) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    if (filterType === 'grayscale-contrast') {
      for (let i = 0; i < data.length; i += 4) {
        // Grayscale
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        // Contrast boost
        const contrast = 1.5; // Коэффициент контрастности
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
        const newValue = factor * (avg - 128) + 128;
        
        data[i] = data[i+1] = data[i+2] = Math.max(0, Math.min(255, newValue));
      }
    } else if (filterType === 'threshold') {
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = avg > 128 ? 255 : 0;
        data[i] = data[i+1] = data[i+2] = val;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9);
  };

  const fetchProductInfoByImage = async (blob) => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      
      const originalUrl = URL.createObjectURL(blob);
      const img = new Image();
      
      const tryDecode = async (src) => {
        try {
          const res = await reader.decodeFromImageUrl(src);
          return res ? res.getText() : null;
        } catch (e) {
          return null;
        }
      };

      // 1. Пытаемся распознать оригинал
      let decodedText = await tryDecode(originalUrl);

      // 2. Если не вышло — пробуем улучшить (ЧБ + Контраст)
      if (!decodedText) {
        console.log("Original failed, applying filters...");
        await new Promise((resolve) => {
          img.onload = resolve;
          img.src = originalUrl;
        });

        const filteredUrl = processCanvas(img, 'grayscale-contrast');
        decodedText = await tryDecode(filteredUrl);
        
        // 3. Если всё еще нет — пробуем жесткий порог (Threshold)
        if (!decodedText) {
          const thresholdUrl = processCanvas(img, 'threshold');
          decodedText = await tryDecode(thresholdUrl);
        }
      }

      URL.revokeObjectURL(originalUrl);

      if (decodedText) {
        console.log("Decode success:", decodedText);
        await fetchProductInfo(decodedText);
      } else {
        // Финальный фолбек на сервер (который на Netlify выдаст 501, но даст понять пользователю)
        const formData = new FormData();
        formData.append('file', blob, 'snapshot.jpg');
        const response = await fetch(getApiUrl('scan'), { method: 'POST', body: formData });
        if (response.status === 501) {
          throw new Error("Код не распознан. Попробуйте сделать фото крупнее и при хорошем свете.");
        }
        const data = await response.json();
        if (data.success) {
          setResult(data);
          stopScanner();
        } else {
          setError(data.error || "Код на снимке не распознан");
        }
      }
    } catch (err) {
      setError('Ошибка: ' + err.message);
      setIsScanning(false);
    } finally {
      setLoading(false);
    }
  };

  const takeSnapshot = () => {
    try {
      if (!videoRef.current) {
        setError("Камера не готова");
        return;
      }
      
      const video = videoRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        setError("Поток камеры пустой. Попробуйте переключить камеру.");
        return;
      }

      setLoading(true);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (!blob) {
          setError("Не удалось захватить кадр");
          setLoading(false);
          return;
        }
        fetchProductInfoByImage(blob);
      }, 'image/jpeg', 0.9);
    } catch (e) {
      setError("Ошибка захвата: " + e.message);
      setLoading(false);
    }
  };

  const startScanner = async () => {
    setIsScanning(true);
    setResult(null);
    setError(null);

    // Настройка ZXing для максимальной чувствительности
    const hints = new Map();
    const formats = [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE];
    hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(DecodeHintType.TRY_HARDER, true); // Самый важный флаг
    hints.set(DecodeHintType.CHARACTER_SET, 'utf-8');

    const reader = new BrowserMultiFormatReader(hints);
    codeReaderRef.current = reader;

    try {
      const videoInputDevices = await reader.listVideoInputDevices();
      
      // Фильтруем виртуальные камеры (OBS, ManyCam и т.д.)
      const realCameras = videoInputDevices.filter(device => 
        !/virtual|obs|manycam|sparkocam/i.test(device.label)
      );

      const usableCameras = realCameras.length > 0 ? realCameras : videoInputDevices;
      setAvailableCameras(usableCameras);

      // Пытаемся найти заднюю камеру
      const backCameraIndex = usableCameras.findIndex(device => 
        /back|rear|задн|мир/i.test(device.label)
      );
      
      const targetIndex = backCameraIndex !== -1 ? backCameraIndex : (usableCameras.length - 1);
      setCurrentCameraIndex(targetIndex);
      const selectedCamera = usableCameras[targetIndex];

      if (!selectedCamera) throw new Error("Камера не найдена");

      const constraints = {
        video: {
          deviceId: selectedCamera.deviceId,
          width: { ideal: 1920, min: 1280 },
          height: { ideal: 1080, min: 720 },
          facingMode: "environment"
        }
      };

      await reader.decodeFromConstraints(constraints, videoRef.current, (result, err) => {
        if (result) {
          fetchProductInfo(result.getText());
        }
      });

      // Проверка поддержки фонарика
      const stream = videoRef.current.srcObject;
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities();
      setHasTorch(!!capabilities.torch);

    } catch (err) {
      console.error(err);
      setError("Не удалось запустить камеру: " + err.message);
      setIsScanning(false);
    }
  };

  const toggleTorch = async () => {
    try {
      if (!videoRef.current || !hasTorch) return;
      const stream = videoRef.current.srcObject;
      const track = stream.getVideoTracks()[0];
      const newState = !isTorchOn;
      await track.applyConstraints({
        advanced: [{ torch: newState }]
      });
      setIsTorchOn(newState);
    } catch (e) {
      console.error("Torch error:", e);
    }
  };

  const switchCamera = async () => {
    if (availableCameras.length < 2) return;
    const nextIndex = (currentCameraIndex + 1) % availableCameras.length;
    setCurrentCameraIndex(nextIndex);
    
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      const selectedCamera = availableCameras[nextIndex];
      const constraints = {
        video: { deviceId: selectedCamera.deviceId }
      };
      await codeReaderRef.current.decodeFromConstraints(constraints, videoRef.current, (result) => {
        if (result) fetchProductInfo(result.getText());
      });
    }
  };

  const stopScanner = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsScanning(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) fetchProductInfoByImage(file);
  };

  const decodeStatus = (status) => {
    const map = {
      'EMITTED': '✅ Выпущен',
      'APPLIED': '📦 Нанесён',
      'INTRODUCED': '🛒 Введён в оборот',
      'RETIRED': '❌ Выбыл из оборота',
      'WRITTEN_OFF': '🗑 Списан',
      'item_sold_receipt': '🛒 Продан (чек)',
      'in_sale': '🛒 В продаже'
    };
    return map[status] || status;
  };

  return (
    <div className="container">
      <header>
        <div className="logo">
          <span className="logo-icon">💊</span>
          <h1>Pillbox</h1>
        </div>
        <p className="subtitle">Умный анализатор лекарственных средств</p>
      </header>

      <main>
        {isScanning ? (
          <div className="scanner-container fade-in">
            <div className="video-wrapper">
              <video ref={videoRef} id="reader-video" playsInline />
              <div className="scanner-overlay">
                <div className="scanner-laser"></div>
              </div>
              {loading && (
                <div className="scanner-processing-overlay">
                  <div className="spinner-small"></div>
                  <span>Обработка снимка...</span>
                </div>
              )}
            </div>
            <div className="scanner-actions">
              <button className="btn-primary flex-1 pulse" onClick={takeSnapshot}>
                🔍 Умный снимок
              </button>
              {hasTorch && (
                <button className={`btn-secondary ${isTorchOn ? 'active' : ''}`} onClick={toggleTorch}>
                  {isTorchOn ? '🔦 Выкл' : '🔦 Свет'}
                </button>
              )}
              {availableCameras.length > 1 && (
                <button className="btn-secondary" onClick={switchCamera}>
                  🔄 Камера
                </button>
              )}
              <button className="btn-secondary" onClick={stopScanner}>Отмена</button>
            </div>
            <p className="scanner-hint">Поднесите код к центру экрана. Если не сканируется — нажмите «Умный снимок»</p>
          </div>
        ) : (
          <div className="scanner-card">
            {loading ? (
              <div className="loader-state">
                <div className="spinner"></div>
                <p>Анализируем данные...</p>
              </div>
            ) : error ? (
              <div className="error-state">
                <div className="error-icon">⚠️</div>
                <p>{error}</p>
                <button className="btn-retry" onClick={() => setError(null)}>Попробовать снова</button>
              </div>
            ) : result ? (
              <div className="result-state fade-in">
                <div className="result-header">
                  <h3>{result.data.productName || result.data.drugsData?.prodDescLabel || 'Товар найден'}</h3>
                  <span className="status-badge">{decodeStatus(result.data.status)}</span>
                </div>

                <div className="info-grid">
                  <div className="info-row"><span className="info-label">Производитель</span><span className="info-value">{result.data.producerName || result.data.drugsData?.packingName || '—'}</span></div>
                  <div className="info-row"><span className="info-label">МНН</span><span className="info-value">{result.data.drugsData?.foiv?.prodNormName || '—'}</span></div>
                  <div className="info-row"><span className="info-label">Форма</span><span className="info-value">{result.data.drugsData?.foiv?.prodFormNormName || '—'}</span></div>
                  <div className="info-row"><span className="info-label">Дозировка</span><span className="info-value">{result.data.drugsData?.foiv?.prodDNormName || '—'}</span></div>
                  <div className="info-row"><span className="info-label">Серия</span><span className="info-value">{result.data.batch || result.data.drugsData?.batch || '—'}</span></div>
                  <div className="info-row"><span className="info-label">По рецепту</span><span className="info-value">{result.data.drugsData?.isRecept !== undefined ? (result.data.drugsData.isRecept ? 'Да 💊' : 'Нет') : '—'}</span></div>
                  <div className="info-row"><span className="info-label">Годен до</span><span className="info-value">{result.data.expDate || result.data.drugsData?.expirationDate || '—'}</span></div>
                </div>

                {result.data.drugsData?.vidalData?.phKinetics && (
                  <div className="description-box">
                    <h4>Описание</h4>
                    <div className="info-text" dangerouslySetInnerHTML={{ __html: result.data.drugsData.vidalData.phKinetics }}></div>
                  </div>
                )}

                <div className="actions">
                  <button className="btn-secondary" onClick={() => setShowRaw(!showRaw)}>
                    {showRaw ? 'Скрыть JSON' : 'Показать сырой JSON'}
                  </button>
                </div>

                {showRaw && (
                  <div className="raw-json">
                    <pre>{JSON.stringify(result, null, 2)}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="welcome-state">
                <div className="scan-icon">💊</div>
                <h2>Проверка маркировки</h2>
                <p>Выберите удобный способ сканирования</p>
              </div>
            )}
          </div>
        )}

        {!isScanning && (
          <div className="upload-controls dual-actions">
            <button className="btn-primary flex-1" onClick={startScanner} disabled={loading}>
              <span className="icon">📷</span> Камера
            </button>
            <label className="btn-secondary flex-1 file-label">
              <span className="icon">🖼️</span> Фото
              <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} disabled={loading} />
            </label>
          </div>
        )}
      </main>

      <footer>
        <p>&copy; 2026 Pillbox Live System</p>
      </footer>
    </div>
  );
};

export default App;
