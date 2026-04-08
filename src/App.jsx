import React, { useState, useEffect, useRef } from 'react';
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

// --- Constants & Helpers ---
const STORAGE_KEYS = {
  PROFILE: 'pillbox_profile',
  KIT: 'pillbox_kit',
  INTAKES: 'pillbox_intakes'
};

const DEFAULT_PROFILE = {
  name: "Артем",
  phone: "+7",
  dob: "",
  gender: "Не указан",
  diseases: "",
  avatar: ""
};

const getApiUrl = (endpoint) => `/api/${endpoint}`;

const getStatus = (item) => {
  if (!item.expDate || item.expDate === '—') return { label: 'В норме', class: 'status-normal' };
  const exp = new Date(item.expDate.split('.').reverse().join('-'));
  const now = new Date();
  if (exp < now) return { label: 'Истек', class: 'status-expired' };
  if (item.quantity <= 5) return { label: 'Мало', class: 'status-warning' };
  return { label: 'В норме', class: 'status-normal' };
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

  // VPN / geo warning
  const [isRussianIp, setIsRussianIp] = useState(true);
  const [vpnWarningVisible, setVpnWarningVisible] = useState(false);

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

    // Определяем страну по IP (без ключа, бесплатно)
    fetch('https://ip-api.com/json/?fields=countryCode')
      .then(r => r.json())
      .then(d => { if (d.countryCode !== 'RU') setIsRussianIp(false); })
      .catch(() => { /* не критично — по умолчанию считаем RU */ });
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

    // Извлечь CIS из URL-формата QR-кода (https://...?cis=01...)
    let cis = decodedText.trim();
    try {
      const urlObj = new URL(cis);
      const cisParam = urlObj.searchParams.get('cis');
      if (cisParam) cis = cisParam;
    } catch { /* не URL */ }

    const withTimeout = (promise, ms) =>
      Promise.race([promise, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

    try {
      // Попытка 1: прямой запрос из браузера (IP пользователя, обходит геоблок Netlify)
      try {
        const res = await withTimeout(
          fetch(`https://mobile.api.crpt.ru/mobile/check?cis=${encodeURIComponent(cis)}`, {
            headers: { 'Accept': 'application/json' }
          }),
          6000
        );
        if (res.ok) {
          const data = await res.json();
          setScanResult({ success: true, cis, data });
          return;
        }
      } catch (e) {
        console.log('Direct browser call failed:', e.message);
      }

      // Попытка 2: через Netlify-функцию (запасной вариант)
      const response = await withTimeout(
        fetch(getApiUrl('scan-text'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cis }),
        }),
        20000
      );
      const data = await response.json();
      if (data.success) {
        setScanResult(data);
      } else {
        setScanError(data.error);
      }
    } catch (err) {
      setScanError('Ошибка сервера: ' + err.message);
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
      <div className="top-search">
        <input 
          type="text" 
          placeholder="Поиск по аптечке" 
          className="top-search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div style={{display: 'flex', gap: '12px', marginBottom: '12px'}}>
        <button className="btn-primary" style={{flex: 1}} onClick={() => setActiveSheet('addMed')}>
          Добавить лекарство
        </button>
      </div>
      
      {kit.length === 0 ? (
        <div className="empty-state">
          <h2>В аптечке пока пусто</h2>
          <p>Добавьте лекарства через сканер или вручную, чтобы они появились здесь.</p>
        </div>
      ) : (
        <div className="fade-in" style={{display:'flex', flexDirection:'column', gap:'12px'}}>
          {kit.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase())).map(item => {
            const status = getStatus(item);
            return (
              <div key={item.id} className="med-card">
                <div className="med-info">
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                    <h3>{item.name}</h3>
                    <span className={`medicine-status-badge ${status.class}`}>{status.label}</span>
                  </div>
                  <p>Остаток: {item.quantity} шт.</p>
                  {item.expDate && <p style={{fontSize: '12px', opacity: 0.6}}>До {item.expDate}</p>}
                </div>
                <button 
                  className="delete-med-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if(window.confirm(`Удалить ${item.name}?`)) {
                      saveKit(kit.filter(k => k.id !== item.id));
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            );
          })}
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
          <button className="nav-fab" onClick={() => {
            if (!isRussianIp) {
              setVpnWarningVisible(true);
              return;
            }
            setActiveSheet('scanner');
            startScanner();
          }}>+</button>
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
        <div className="profile-header-centered">
          <div className="profile-avatar-large">
            <svg viewBox="0 0 24 24" className="avatar-icon"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <div className="avatar-edit-icon">
               <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </div>
          </div>
        </div>
        
        <div className="form-group" style={{marginTop: '24px'}}>
             <div className="input-block">
               <label>Ваше имя</label>
               <input type="text" value={profile.name} onChange={e => saveProfile({...profile, name: e.target.value})} placeholder="Имя" />
             </div>
             <div className="input-block">
               <label>Номер телефона</label>
               <input type="text" value={profile.phone || '+7'} onChange={e => saveProfile({...profile, phone: e.target.value})} placeholder="+7" />
             </div>
             <div className="input-block">
               <label>Аллергия / Заболевания</label>
               <textarea value={profile.diseases} onChange={e => saveProfile({...profile, diseases: e.target.value})} placeholder="Описание" style={{height:'100px'}} />
             </div>
             <button className="btn-primary" onClick={() => setActiveSheet(null)}>Сохранить</button>
        </div>
      </Sheet>

      <Sheet id="intakesList" title="Прием лекарств" active={activeSheet} onClose={() => setActiveSheet(null)}>
        <button className="btn-primary" style={{marginBottom: '20px'}} onClick={() => setActiveSheet('addIntake')}>Добавить прием</button>
        {intakes.length === 0 ? (
          <div className="empty-state">
            <p>Пока нету приемов</p>
          </div>
        ) : (
          <div className="med-list">
            {intakes.sort((a,b) => a.time.localeCompare(b.time)).map(item => (
              <div key={item.id} className={`med-card ${item.taken ? 'taken' : ''}`} style={{marginBottom:'12px'}}>
                <div className="med-info" onClick={() => toggleIntake(item.id)}>
                  <div style={{display:'flex', justifyContent:'space-between'}}>
                    <h3>{item.name}</h3>
                    <div style={{opacity: 0.5}}>{item.time === "00:00" ? "-- : --" : item.time}</div>
                  </div>
                  <p>Остаток: {kit.find(k => k.id === item.medId)?.quantity || 0} шт.</p>
                </div>
                <div className="med-actions" style={{marginLeft:'16px', display:'flex', alignItems:'center', gap:'8px'}}>
                   <div className="check-btn" onClick={() => toggleIntake(item.id)}>
                    {item.taken ? '✓' : ''}
                  </div>
                  <button 
                    className="delete-med-btn" 
                    style={{width:'32px', height:'32px', borderRadius:'10px', marginLeft:0}}
                    onClick={(e) => {
                      e.stopPropagation();
                      if(window.confirm('Удалить этот прием?')) {
                        saveIntakes(intakes.filter(idx => idx.id !== item.id));
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet id="addMed" title="Новое лекарство" active={activeSheet} onClose={() => setActiveSheet(null)}>
        <div className="form-group">
          <div className="input-block">
            <label>Название лекарства</label>
            <input type="text" id="new-med-name" placeholder="Например, парацетамол" />
          </div>
          <div className="input-block">
            <label>Срок годности</label>
            <input type="text" id="new-med-exp" placeholder="DD/MM/YYYY" />
          </div>
          <button className="btn-primary" onClick={() => {
            const name = document.getElementById('new-med-name').value;
            const exp = document.getElementById('new-med-exp').value;
            if(name) {
              saveKit([...kit, { id: Date.now(), name, quantity: 10, expDate: exp }]);
              setActiveSheet(null);
            }
          }}>Добавить лекарство</button>
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

      <Sheet id="search" title="Поиск по аптекам" active={activeSheet} onClose={() => setActiveSheet(null)}>
        <div className="form-group">
          <div className="input-block">
            <label>Название лекарства</label>
            <input type="text" placeholder="Например, парацетамол" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={performSearch}>Найти в магазинах</button>
        </div>
        
        <div style={{marginTop: '20px'}}>
          {searchResults.length > 0 && <p style={{fontSize:'14px', marginBottom:'12px', opacity:0.6}}>Можно посмотреть на карте</p>}
          {searchResults.map((res, i) => (
            <a key={i} href={res.url} target="_blank" rel="noreferrer" className="external-link">
              <span>{res.name}</span>
            </a>
          ))}
          <button className="btn-primary" onClick={() => setShowMap(!showMap)} style={{marginTop:'12px'}}>
            {showMap ? 'Скрыть карту' : 'Показать аптеки на карте'}
          </button>
          {showMap && (
            <div className="fade-in" style={{marginTop: '16px'}}>
              <iframe className="map-frame" src="https://yandex.ru/map-widget/v1/?text=%D0%B0%D0%BF%D1%82%D0%B5%D0%BA%D0%B0" />
            </div>
          )}
        </div>
      </Sheet>

      <Sheet id="scanner" title="Сканирование Честного Знака" active={activeSheet} onClose={() => { setActiveSheet(null); stopScanner(); }}>
        <p style={{fontSize: '14px', opacity: 0.6, marginTop:'-16px', marginBottom: '24px'}}>
            Наведите камеру на Честный Знак с упаковки лекарства. Сканирование может занять несколько секунд.
        </p>
        {!scanResult && !scanError ? (
          <div className="fade-in">
             <div className="scanner-viewbox">
                <video ref={videoRef} playsInline />
                <div className="scanner-overlay-rect" />
                <div className="scanner-laser" />
             </div>
             <div className="scanner-status-bar">
                {loading ? 'Обработка...' : 'Сканирование запущено...'}
             </div>
             <div className="form-group" style={{marginTop:'20px'}}>
               <button className="btn-primary" onClick={handleSmartSnapshot}>Умный снимок</button>
             </div>
          </div>
        ) : scanResult ? (
          <div className="result-box-premium fade-in">
            <span className="status-badge-ok">Сканирование выполнено</span>
            <div className="res-card" style={{marginTop:'16px'}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                    <h3>{scanResult.data.productName || scanResult.data.drugsData?.prodDescLabel}</h3>
                    <button style={{background:'none', border:'none', color:'#BCBCBC', fontSize:'12px'}}>Изменить</button>
                </div>
                <p style={{fontSize:'12px', opacity:0.6}}>Годен до: {scanResult.data.expDate || scanResult.data.drugsData?.expirationDate || '—'}</p>
            </div>
            <button className="btn-primary" style={{marginTop:'24px'}} onClick={() => addToKit(scanResult.data)}>Добавить лекарство</button>
            <button className="btn-secondary-outline" style={{marginTop:'12px', border:'none', background:'none'}} onClick={() => { setScanResult(null); startScanner(); }}>Сканировать ещё</button>
          </div>
        ) : (
          <div className="result-box-premium fade-in">
            <span className="status-badge-error">Сканирование не выполнено</span>
            <div className="res-card" style={{marginTop:'16px'}}>
                <h3>Лекарство не найдено</h3>
            </div>
            <button className="btn-primary" style={{marginTop:'24px'}} onClick={() => { setScanError(null); setActiveSheet('addMed'); }}>Добавить вручную</button>
            <button className="btn-secondary-outline" style={{marginTop:'12px', border:'none', background:'none'}} onClick={() => { setScanError(null); startScanner(); }}>Попробовать снова</button>
          </div>
        )}
      </Sheet>

      {/* VPN-предупреждение */}
      {vpnWarningVisible && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 9999, padding: '0 16px 32px'
        }} onClick={() => setVpnWarningVisible(false)}>
          <div style={{
            background: '#1C1C1E', borderRadius: '20px', padding: '24px',
            width: '100%', maxWidth: '420px', textAlign: 'center'
          }} onClick={e => e.stopPropagation()}>
            <div style={{fontSize: '40px', marginBottom: '12px'}}>🌍</div>
            <h3 style={{margin: '0 0 8px', fontSize: '17px', fontWeight: 700}}>
              Сканер недоступен
            </h3>
            <p style={{margin: '0 0 20px', fontSize: '14px', color: '#EBEBF5', lineHeight: 1.5}}>
              Обнаружен не российский IP-адрес. Сканер работает только без VPN — выключите его и попробуйте снова.
            </p>
            <button className="btn-primary" style={{marginBottom: '10px'}} onClick={() => {
              setVpnWarningVisible(false);
              setActiveSheet('scanner');
              startScanner();
            }}>
              Всё равно попробовать
            </button>
            <button style={{
              background: 'none', border: 'none', color: '#ffffff',
              fontSize: '15px', cursor: 'pointer', width: '100%', padding: '8px'
            }} onClick={() => setVpnWarningVisible(false)}>
              Закрыть
            </button>

          </div>
        </div>
      )}
    </div>
  );
};

export default App;
