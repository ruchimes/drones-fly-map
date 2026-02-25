
import React, { useState } from 'react';
import MapView from './components/MapView';
import SearchBar from './components/SearchBar';


function App() {
  const [location, setLocation] = useState(null);
  const [zones, setZones] = useState([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [canFly, setCanFly] = useState(null);
  const [reasons, setReasons] = useState([]);

  const [radius, setRadius] = useState(1000); // metros
  const [maxAllowedHeight, setMaxAllowedHeight] = useState(null);

  // Nuevo: setSummary para SearchBar
  const setSummary = (summary) => {
    setCanFly(summary?.canFly ?? null);
    setReasons(summary?.reasons ?? []);
    setMaxAllowedHeight(summary?.maxAllowedHeight ?? null);
  };

  // Manejar click en el mapa
  const handleMapClick = async (latlng) => {
    setLoadingZones(true);
    setLocation({ lat: latlng.lat, lon: latlng.lng });
    try {
  const zonesRes = await fetch(`/api/zones?lat=${latlng.lat}&lon=${latlng.lng}&radius=${radius}`);
  const data = await zonesRes.json();
  setZones(Array.isArray(data.zones) ? data.zones : []);
  setSummary({ canFly: data.canFly, reasons: data.reasons, maxAllowedHeight: data.maxAllowedHeight });
    } catch (err) {
      setZones([]);
      setSummary(null);
    }
    setLoadingZones(false);
  };

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      <SearchBar setLocation={setLocation} setZones={setZones} setLoadingZones={setLoadingZones} setSummary={setSummary} radius={radius} setRadius={setRadius} />
      {loadingZones && (
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(255,255,255,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000
        }}>
          <div className="spinner" style={{fontSize: 32}}>
            <svg width="60" height="60" viewBox="0 0 44 44" stroke="#1976d2">
              <g fill="none" fillRule="evenodd" strokeWidth="4">
                <circle cx="22" cy="22" r="18" strokeOpacity=".5"/>
                <path d="M40 22c0-9.94-8.06-18-18-18">
                  <animateTransform attributeName="transform" type="rotate" from="0 22 22" to="360 22 22" dur="1s" repeatCount="indefinite"/>
                </path>
              </g>
            </svg>
          </div>
        </div>
      )}
      <div style={{position:'absolute',top:60,left:10,zIndex:1200,minWidth:320,maxWidth:400,background:'#fff',borderRadius:8,boxShadow:'0 2px 8px #0002',padding:16,display: canFly!==null ? 'block':'none'}}>
        {canFly!==null && (
          <div>
            <b>¿Se puede volar?</b><br/>
            <span style={{color: canFly ? 'green' : 'red', fontWeight:'bold'}}>
              {canFly ? 'SÍ' : 'NO'}
            </span>
            {canFly && maxAllowedHeight && (
              <div style={{marginTop:8, color:'#1976d2', fontWeight:'bold'}}>
                Altura máxima permitida: {maxAllowedHeight} m
              </div>
            )}
            <ul style={{marginTop:8}}>
              {reasons.map((r,i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}
      </div>
      <MapView location={location} zones={zones} radius={radius} onMapClick={handleMapClick} />
    </div>
  );
}

export default App;
