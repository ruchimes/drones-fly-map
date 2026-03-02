
import React, { useState, useCallback, useRef } from 'react';

import MapView from './components/MapView';
import SearchBar from './components/SearchBar';
import SummaryMessage from './components/SummaryMessage';
import { HeatmapLegend } from './components/HeatmapLayer';
import { useZones } from './hooks/useZones';
import { useHeatmap } from './hooks/useHeatmap';
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

  // Ref compartido: se activa cuando el usuario pincha una celda del heatmap
  // para que handleMapClick ignore el click del mapa que llega justo después
  const cellClickedRef = useRef(0);

  const {
    location, setLocation,
    zones,
    loading,
    summary, setSummary, clearSummary,
    handleMapClick,
    fetchByAddress,
  } = useZones(radius, cellClickedRef);

  // Muestra en el panel superior el resultado ya calculado de una celda del heatmap
  const setSummaryFromCell = useCallback(cell => {
    setSummary({
      canFly:           cell.canFly,
      maxAllowedHeight: cell.maxAllowedHeight,
      reasons:          cell.reasons ?? [],
    });
    setLocation({ lat: cell.lat, lon: cell.lon });
  }, [setSummary, setLocation]);

  const {
    heatmap,
    heatmapLoading,
    heatmapError,
    progress,
    fetchHeatmap,
    clearHeatmap,
  } = useHeatmap();

  const handleAnalyze = () => {
    if (!location) return;
    fetchHeatmap(location.lat, location.lon, { radiusKm: radius / 1000, cellM: 100, concurrency: 15 });
  };

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>

      <MapView
        location={location}
        zones={zones}
        radius={radius}
        onMapClick={handleMapClick}
        heatmap={heatmap}
        cellClickedRef={cellClickedRef}
        onHeatmapCellClick={cell => {
          cellClickedRef.current = Date.now(); // marcar antes de que llegue el click del mapa
          console.log('[APP] onHeatmapCellClick fired, ref=', cellClickedRef.current);
          setSummaryFromCell(cell);
        }}
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
            heatmapActive={!!heatmap}
            heatmapLoading={heatmapLoading}
            heatmapError={heatmapError}
            onAnalyze={handleAnalyze}
            onClearHeatmap={clearHeatmap}
            hasLocation={!!location}
          />
        </div>
      </div>

      {/* Overlay de carga principal (consulta de zona) */}
      {loading && <LoadingOverlay />}

      {/* Overlay de carga del heatmap con barra de progreso SSE */}
      {heatmapLoading && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(255,255,255,0.55)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 2000, gap: 16,
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.97)',
            borderRadius: 14,
            padding: '20px 28px',
            fontWeight: 600,
            fontSize: 15,
            color: '#1565c0',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            textAlign: 'center',
            minWidth: 260,
          }}>
            <div style={{ marginBottom: 10 }}>
              {progress?.phase === 'elevaciones'
                ? '🏔️ Consultando elevaciones del terreno…'
                : '🗺️ Analizando cuadrícula…'}
            </div>

            {/* Barra de progreso */}
            <div style={{
              width: '100%',
              height: 18,
              borderRadius: 9,
              background: '#f0f0f0',
              overflow: 'hidden',
              border: '1px solid #ddd',
              marginBottom: 8,
            }}>
              <div style={{
                height: '100%',
                borderRadius: 9,
                background: progress?.phase === 'elevaciones'
                  ? 'linear-gradient(90deg, #42a5f5, #1565c0)'
                  : 'linear-gradient(90deg, #81c784, #43a047)',
                width: (progress && progress.phase !== 'elevaciones')
                  ? `${Math.round((progress.done / progress.total) * 100)}%`
                  : progress?.phase === 'elevaciones' ? '15%' : '0%',
                transition: 'width 0.3s ease',
              }} />
            </div>

            <div style={{ fontWeight: 400, fontSize: 13, color: '#555' }}>
              {progress?.phase === 'elevaciones'
                ? 'Obteniendo alturas del terreno (1 consulta)…'
                : progress
                  ? `${progress.done} / ${progress.total} celdas (${Math.round((progress.done / progress.total) * 100)}%)`
                  : 'Iniciando…'}
            </div>
          </div>
        </div>
      )}

      {/* Leyenda del heatmap */}
      {heatmap && <HeatmapLegend />}

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
