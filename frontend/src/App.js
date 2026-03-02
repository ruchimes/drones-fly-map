
import React, { useState } from 'react';

import MapView from './components/MapView';
import SearchBar from './components/SearchBar';
import SummaryMessage from './components/SummaryMessage';
import { useZones } from './hooks/useZones';
import './leaflet-fix.css';
import './bottom-bar.css';

// ─── Spinner ──────────────────────────────────────────────────────────────────

function LoadingOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(255,255,255,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000,
    }}>
      <svg width="60" height="60" viewBox="0 0 44 44" stroke="#1976d2">
        <g fill="none" fillRule="evenodd" strokeWidth="4">
          <circle cx="22" cy="22" r="18" strokeOpacity=".5" />
          <path d="M40 22c0-9.94-8.06-18-18-18">
            <animateTransform
              attributeName="transform" type="rotate"
              from="0 22 22" to="360 22 22"
              dur="1s" repeatCount="indefinite"
            />
          </path>
        </g>
      </svg>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [radius, setRadius] = useState(500); // metros

  const {
    location, setLocation,
    zones,
    loading,
    summary, clearSummary,
    handleMapClick,
    fetchByAddress,
  } = useZones(radius);

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>

      <MapView
        location={location}
        zones={zones}
        radius={radius}
        onMapClick={handleMapClick}
      />

      {/* Barra inferior traslúcida sobre el mapa */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        zIndex: 1500, pointerEvents: 'none',
      }}>
        <div className="bottom-bar" style={{ pointerEvents: 'auto' }}>
          <SearchBar
            setLocation={setLocation}
            radius={radius}
            setRadius={setRadius}
            fetchByAddress={fetchByAddress}
          />
        </div>
      </div>

      {/* Overlay de carga */}
      {loading && <LoadingOverlay />}

      {/* Panel de resultado arriba */}
      <div style={{
        position: 'absolute', top: 10, left: 0, right: 0,
        zIndex: 1100, display: 'flex', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <SummaryMessage
          canFly={summary?.canFly ?? null}
          reasons={summary?.reasons ?? []}
          maxAllowedHeight={summary?.maxAllowedHeight ?? null}
          onClose={clearSummary}
        />
      </div>

    </div>
  );
}

export default App;
