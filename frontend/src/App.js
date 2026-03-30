
import React, { useState, useCallback, useRef, useEffect } from 'react';

import MapView from './components/MapView';
import SearchBar from './components/SearchBar';
import SummaryMessage from './components/SummaryMessage';
import LoadingOverlay from './components/LoadingOverlay';
import HeatmapProgress from './components/HeatmapProgress';
import { HeatmapLegend } from './components/HeatmapLayer';
import { useZones } from './hooks/useZones';
import { useHeatmap } from './hooks/useHeatmap';
import { useAnalysisHistory } from './hooks/useAnalysisHistory';
import './leaflet-fix.css';
import './bottom-bar.css';

function App() {
  const [radius, setRadius]       = useState(500); // metros
  const [showLegend, setShowLegend] = useState(false);
  const [urbanEnabled, setUrbanEnabled] = useState(
    () => localStorage.getItem('urbanEnabled') !== 'false'
  );

  const toggleUrban = () => setUrbanEnabled(prev => {
    const next = !prev;
    localStorage.setItem('urbanEnabled', String(next));
    return next;
  });

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

  // Muestra en el panel el resultado ya calculado de una celda del heatmap
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
    loadHeatmapFromCells,
  } = useHeatmap();

  // ── Historial de análisis ─────────────────────────────────────────────────
  const { hasSavedAnalyses, saveAnalysis, getMergedCells } = useAnalysisHistory();

  const handleAnalyze = () => {
    if (!location) return;
    setShowLegend(true);
    fetchHeatmap(location.lat, location.lon, {
      radiusKm: radius / 1000,
      cellM: 100,
      concurrency: 15,
      onResult: async (data) => {
        // 1. Guarda el nuevo análisis en el backend
        await saveAnalysis({
          center: { lat: location.lat, lon: location.lon },
          radius,
          cellM: data.cellM ?? 100,
          cells: data.cells,
        });
        // 2. Carga el historial completo deduplicado (nuevo + todos los anteriores)
        const allCells = await getMergedCells();
        if (allCells.length) {
          loadHeatmapFromCells(allCells);
        }
      },
    });
  };

  // Carga el heatmap con la unión de todos los análisis previos
  const handleShowHistory = useCallback(async () => {
    const allCells = await getMergedCells();
    if (!allCells.length) return;
    setShowLegend(true);
    loadHeatmapFromCells(allCells);
  }, [getMergedCells, loadHeatmapFromCells]);

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
          cellClickedRef.current = Date.now();
          setSummaryFromCell(cell);
        }}
      />

      {/* Barra inferior */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1500, pointerEvents: 'none' }}>
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
            onShowHistory={handleShowHistory}
            hasLocation={!!location}
          />
        </div>
      </div>

      {/* Overlays de carga */}
      {loading && <LoadingOverlay />}
      {heatmapLoading && <HeatmapProgress progress={progress} />}

      {/* Leyenda del heatmap con botón de cerrar */}
      {heatmap && showLegend && (
        <div style={{ position: 'absolute', bottom: 190, right: 14, zIndex: 1200 }}>
          <HeatmapLegend onClose={() => setShowLegend(false)} />
        </div>
      )}

      {/* Panel de resultado (arriba, centrado) */}
      <div style={{
        position: 'absolute', top: 10, left: 0, right: 0,
        zIndex: 1100, display: 'flex', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <SummaryMessage
          canFly={summary?.canFly ?? null}
          reasons={summary?.reasons ?? []}
          maxAllowedHeight={summary?.maxAllowedHeight ?? null}
          urban={summary?.urban ?? null}
          urbanEnabled={urbanEnabled}
          onToggleUrban={toggleUrban}
          onClose={clearSummary}
        />
      </div>

    </div>
  );
}

export default App;
