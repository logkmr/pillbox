import React, { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

// --- Constants & Helpers ---
const STORAGE_KEYS = {
  PROFILE: 'pillbox_profile',
  KIT: 'pillbox_kit',
  INTAKES: 'pillbox_intakes'
};

const DEFAULT_PROFILE = {
  name: "Пользователь",
  username: "@user",
  dob: "",
  gender: "Не указан",
  diseases: "Нет данных",
  avatar: ""
};

const getApiUrl = (endpoint) => `/api/${endpoint}`;

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

// --- Sub-components ---

const Sheet = ({ id, active, title, onClose, children }) => (
  <div className={`sheet ${active === id ? 'active' : ''}`} id={id}>
    <div className="sheet-header">
      <h2>{title}</h2>
      <button className="close-btn" onClick={onClose}>×</button>
    </div>
    <div className="sheet-content">
      {children}
    </div>
  </div>
);

const App = () => {
  // --- State ---
  const [activeSheet, setActiveSheet] = useState(null);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [kit, setKit] = useState([]);
  const [intakes, setIntakes] = useState([]);
  
  // Scanner State
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showMap, setShowMap] = useState(false);

  // Refs
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);

  // --- Initialization ---
  useEffect(() => {
    const savedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);
    if (savedProfile) setProfile(JSON.parse(savedProfile));

    const savedKit = localStorage.getItem(STORAGE_KEYS.KIT);
    if (savedKit) setKit(JSON.parse(savedKit));

    const savedIntakes = localStorage.getItem(STORAGE_KEYS.INTAKES);
    if (savedIntakes) setIntakes(JSON.parse(savedIntakes));
  }, []);

  const saveProfile = (newProfile) => {
    setProfile(newProfile);
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(newProfile));
  };

  const saveKit = (newKit) => {
    setKit(newKit);
    localStorage.setItem(STORAGE_KEYS.KIT, JSON.stringify(newKit));
  };

  const saveIntakes = (newIntakes) => {
    setIntakes(newIntakes);
    localStorage.setItem(STORAGE_KEYS.INTAKES, JSON.stringify(newIntakes));
  };

  // --- Logic ---

  // Scanner Logic
  const startScanner = async () => {
    setIsScanning(true);
    setScanResult(null);
    setScanError(null);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    const reader = new BrowserMultiFormatReader(hints);
    codeReaderRef.current = reader;

    try {
      const videoInputDevices = await reader.listVideoInputDevices();
      const backCamera = videoInputDevices.find(device => /back|rear|задн|мир/i.test(device.label)) || videoInputDevices[0];

      const constraints = {
        video: {
          deviceId: backCamera?.deviceId,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "environment"
        }
      };

      await reader.decodeFromConstraints(constraints, videoRef.current, (result) => {
        if (result) {
          fetchProductInfo(result.getText());
        }
      });

      const stream = videoRef.current.srcObject;
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities();
      setHasTorch(!!capabilities.torch);

    } catch (err) {
      setScanError("Не удалось запустить камеру: " + err.message);
    }
  };

  const stopScanner = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsScanning(false);
  };

  const fetchProductInfo = async (decodedText) => {
    setLoading(true);
    stopScanner();
    try {
      const response = await fetch(getApiUrl('scan-text'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: decodedText.trim() }),
      });
      const data = await response.json();
      if (data.success) {
        setScanResult(data);
      } else {
        setScanError(data.error);
      }
    } catch (err) {
      setScanError(' Ошибка сервера: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSmartSnapshot = () => {
    if (!videoRef.current) return;
    setLoading(true);
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0);
    
    canvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append('file', blob, 'snapshot.jpg');
      try {
        const response = await fetch(getApiUrl('scan'), { method: 'POST', body: formData });
        const data = await response.json();
        if (data.success) {
          setScanResult(data);
          stopScanner();
        } else {
          setScanError(data.error || "Код не распознан");
        }
      } catch (e) {
        setScanError("Ошибка: " + e.message);
      } finally {
        setLoading(false);
      }
    }, 'image/jpeg', 0.9);
  };

  const addToKit = (productData) => {
    const name = productData.productName || productData.drugsData?.prodDescLabel || "Новое лекарство";
    const newItem = {
      id: Date.now(),
      name: name,
      quantity: 1,
      batch: productData.batch || productData.drugsData?.batch || "—",
      expDate: productData.expDate || productData.drugsData?.expirationDate || "—"
    };
    saveKit([...kit, newItem]);
    setScanResult(null);
    setActiveSheet(null);
  };

  // Intake Logic
  const addIntake = (medId, time, count) => {
    const med = kit.find(k => k.id === medId);
    if (!med) return;
    const newIntake = {
      id: Date.now(),
      medId,
      name: med.name,
      time,
      count: parseInt(count),
      taken: false
    };
    saveIntakes([...intakes, newIntake]);
    setActiveSheet(null);
  };

  const toggleIntake = (id) => {
    const updated = intakes.map(idx => {
      if (idx.id === id) {
        // If marking as taken, subtract from inventory
        if (!idx.taken) {
          const updatedKit = kit.map(item => {
            if (item.id === idx.medId) return { ...item, quantity: Math.max(0, item.quantity - idx.count) };
            return item;
          });
          saveKit(updatedKit);
        } else {
          // If unmarking, add back
          const updatedKit = kit.map(item => {
            if (item.id === idx.medId) return { ...item, quantity: item.quantity + idx.count };
            return item;
          });
          saveKit(updatedKit);
        }
        return { ...idx, taken: !idx.taken };
      }
      return idx;
    });
    saveIntakes(updated);
  };

  // Search Logic
  const performSearch = () => {
    if (!searchQuery) return;
    const terms = encodeURIComponent(searchQuery);
    const results = [
      { name: 'Apteka.ru', url: `https://apteka.ru/search/?q=${terms}` },
      { name: 'Eapteka.ru', url: `https://www.eapteka.ru/search/?q=${terms}` },
      { name: 'Yandex Market', url: `https://market.yandex.ru/search?text=${terms}` }
    ];
    setSearchResults(results);
  };

  // --- Render Sections ---

  const renderDashboard = () => (
    <main className="main-content">
      <div style={{display: 'flex', gap: '12px', marginBottom: '12px'}}>
        <button className="btn-primary" style={{flex: 1}} onClick={() => setActiveSheet('addMed')}>
          Добавить вручную
        </button>
      </div>
      
      {kit.length === 0 ? (
        <div className="empty-state">
          <h2>В аптечке пока пусто</h2>
          <p>Добавьте лекарства через сканер или вручную, чтобы они появились здесь.</p>
        </div>
      ) : (
        <div className="fade-in" style={{display:'flex', flexDirection:'column', gap:'16px'}}>
          {kit.map(item => (
            <div key={item.id} className="med-card">
              <div className="med-info">
                <h3>{item.name}</h3>
                <p>Остаток: {item.quantity} шт.</p>
                {item.expDate && <p style={{fontSize: '12px', opacity: 0.8}}>Годен до: {item.expDate}</p>}
              </div>
              <div className="med-actions">
                <button 
                  className="close-btn" 
                  style={{background: 'none', fontSize: '24px'}} 
                  onClick={(e) => {
                    e.stopPropagation();
                    saveKit(kit.filter(k => k.id !== item.id));
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-top-row">
          <div className="greeting">
            <h1>Привет, {profile.name.split(' ')[0]}!</h1>
            <p>Ваша домашняя аптечка</p>
          </div>
          <button className="header-profile-btn" onClick={() => setActiveSheet('profile')}>
            <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </button>
        </div>
      </header>

      {renderDashboard()}

      <nav className="bottom-nav">
        <div className="nav-item">
          <button className="nav-icon" onClick={() => setActiveSheet('search')}>
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          <span className="nav-label">Поиск</span>
        </div>
        
        <div className="nav-item" style={{ flex: 0 }}>
          <button className="nav-fab" onClick={() => { setActiveSheet('scanner'); startScanner(); }}>+</button>
          <span className="nav-label">Сканер</span>
        </div>
        
        <div className="nav-item">
          <button className="nav-icon" onClick={() => setActiveSheet('intakesList')}>
            <svg viewBox="0 0 24 24">
              <path d="M19 4H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zm-7 5h5v2h-5z"/>
            </svg>
          </button>
          <span className="nav-label">Приёмы</span>
        </div>
      </nav>

      {/* --- Sheets --- */}

      <Sheet id="profile" title="Профиль" active={activeSheet} onClose={() => setActiveSheet(null)}>
        <div className="profile-header">
           <div className="profile-main">
             <div className="profile-avatar">
               {profile.name.charAt(0)}
             </div>
             <strong style={{fontSize: '24px'}}>{profile.name}</strong>
           </div>
        </div>
        <div className="data-row"><span className="data-label">Username</span><span className="data-value">{profile.username}</span></div>
        <div className="data-row"><span className="data-label">Пол</span><span className="data-value">{profile.gender}</span></div>
        <div className="form-group" style={{marginTop: '20px'}}>
             <div className="input-block">
               <label>Имя</label>
               <input type="text" value={profile.name} onChange={e => saveProfile({...profile, name: e.target.value})} />
             </div>
             <div className="input-block">
               <label>Заболевания / Аллергии</label>
               <textarea value={profile.diseases} onChange={e => saveProfile({...profile, diseases: e.target.value})} />
             </div>
        </div>
      </Sheet>

      <Sheet id="intakesList" title="График приёма" active={activeSheet} onClose={() => setActiveSheet(null)}>
        <button className="btn-primary" style={{marginBottom: '20px'}} onClick={() => setActiveSheet('addIntake')}>Добавить в график</button>
        {intakes.length === 0 ? (
          <div className="empty-state">
            <h2>Расписание пусто</h2>
            <p>Добавьте приём лекарства, чтобы отслеживать время.</p>
          </div>
        ) : (
          <div className="med-list">
            {intakes.sort((a,b) => a.time.localeCompare(b.time)).map(item => (
              <div key={item.id} className={`med-card ${item.taken ? 'taken' : ''}`} onClick={() => toggleIntake(item.id)}>
                <div className="med-info">
                  <h3>{item.name}</h3>
                  <p>{item.count} шт.</p>
                </div>
                <div className="med-actions">
                  <div className="med-time">{item.time}</div>
                  <div className="check-btn">
                    {item.taken ? '✓' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet id="addMed" title="Новое лекарство" active={activeSheet} onClose={() => setActiveSheet(null)}>
        <div className="form-group">
          <div className="input-block">
            <label>Название</label>
            <input type="text" id="new-med-name" placeholder="Напр. Парацетамол" />
          </div>
          <div className="input-block">
            <label>Количество</label>
            <input type="number" id="new-med-qty" placeholder="10" />
          </div>
          <button className="btn-primary" onClick={() => {
            const name = document.getElementById('new-med-name').value;
            const qty = document.getElementById('new-med-qty').value;
            if(name) {
              saveKit([...kit, { id: Date.now(), name, quantity: parseInt(qty || 0) }]);
              setActiveSheet(null);
            }
          }}>Сохранить</button>
        </div>
      </Sheet>

      <Sheet id="addIntake" title="Новый приём" active={activeSheet} onClose={() => setActiveSheet(null)}>
        <div className="form-group">
          <div className="input-block">
            <label>Выберите лекарство</label>
            <select id="intake-med">
              {kit.length === 0 && <option value="">Сначала добавьте в аптечку</option>}
              {kit.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div className="input-block">
            <label>Кол-во таблеток</label>
            <input type="number" id="intake-count" defaultValue="1" />
          </div>
          <div className="input-block">
            <label>Время приема</label>
            <input type="time" id="intake-time" defaultValue="09:00" />
          </div>
          <button className="btn-primary" onClick={() => {
            const medId = parseInt(document.getElementById('intake-med').value);
            const count = document.getElementById('intake-count').value;
            const time = document.getElementById('intake-time').value;
            addIntake(medId, time, count);
          }}>Добавить в график</button>
        </div>
      </Sheet>

      <Sheet id="search" title="Поиск лекарств" active={activeSheet} onClose={() => setActiveSheet(null)}>
        <div className="input-block" style={{flexDirection: 'row', gap: '8px'}}>
          <input type="text" placeholder="Название..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          <button className="btn-primary" style={{margin:0, width:'auto', padding:'12px 20px'}} onClick={performSearch}>🔎</button>
        </div>
        
        <div style={{marginTop: '20px'}}>
          {searchResults.map((res, i) => (
            <a key={i} href={res.url} target="_blank" rel="noreferrer" className="external-link">
              <span>{res.name}</span>
              <span>Найти {searchQuery} в аптеке</span>
            </a>
          ))}
          <button className="btn-secondary-outline" style={{marginTop: '12px'}} onClick={() => setShowMap(!showMap)}>
            {showMap ? 'Скрыть карту' : 'Аптеки рядом'}
          </button>
          {showMap && (
            <div className="fade-in" style={{marginTop: '16px'}}>
              <iframe className="map-frame" src="https://yandex.ru/map-widget/v1/?text=%D0%B0%D0%BF%D1%82%D0%B5%D0%BA%D0%B0" />
            </div>
          )}
        </div>
      </Sheet>

      <Sheet id="scanner" title="Сканер Data Matrix" active={activeSheet} onClose={() => { setActiveSheet(null); stopScanner(); }}>
        {!scanResult ? (
          <div className="fade-in">
             <div className="scanner-viewbox">
                <video ref={videoRef} playsInline />
                <div className="scanner-overlay-rect" />
                <div className="scanner-laser" />
             </div>
             {loading && <div className="scanner-status">Обработка...</div>}
             {scanError && <div className="scanner-status" style={{color:'red'}}>{scanError}</div>}
             <div className="form-group" style={{marginTop:'20px'}}>
               <button className="btn-primary" onClick={handleSmartSnapshot}>Умный снимок</button>
               {hasTorch && (
                 <button className="btn-secondary-outline" onClick={() => {
                   const track = videoRef.current.srcObject.getVideoTracks()[0];
                   track.applyConstraints({ advanced: [{ torch: !isTorchOn }] });
                   setIsTorchOn(!isTorchOn);
                 }}>{isTorchOn ? 'Выключить свет' : 'Включить свет'}</button>
               )}
             </div>
          </div>
        ) : (
          <div className="result-box fade-in">
            <span className="status-badge">{decodeStatus(scanResult.data.status)}</span>
            <h3>{scanResult.data.productName || scanResult.data.drugsData?.prodDescLabel}</h3>
            <div style={{marginTop:'12px', fontSize:'14px', color:'#666'}}>
               <p>Производитель: {scanResult.data.producerName || scanResult.data.drugsData?.packingName || '—'}</p>
               <p>Годен до: {scanResult.data.expDate || scanResult.data.drugsData?.expirationDate || '—'}</p>
            </div>
            <button className="btn-primary" style={{marginTop:'20px'}} onClick={() => addToKit(scanResult.data)}>Добавить в аптечку</button>
            <button className="btn-secondary-outline" style={{marginTop:'8px'}} onClick={() => setScanResult(null)}>Сканировать ещё</button>
          </div>
        )}
      </Sheet>
    </div>
  );
};

export default App;
