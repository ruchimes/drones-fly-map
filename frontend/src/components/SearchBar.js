
import React, { useState } from 'react';

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = {
  form: {
    padding: 10,
    background: 'transparent',
    zIndex: 1000,
    width: '100%',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  input: {
    width: 220,
    padding: '8px 14px',
    border: '1.5px solid #c0c4cc',
    borderRadius: 14,
    background: 'rgba(245,245,247,0.85)',
    color: '#222',
    fontSize: 15,
    outline: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  },
  label: {
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: '#555',
    background: 'rgba(240,240,240,0.7)',
    borderRadius: 10,
    padding: '4px 10px',
  },
  range: {
    width: 100,
    accentColor: '#888',
    background: 'transparent',
    borderRadius: 8,
  },
  rangeValue: {
    minWidth: 44,
    display: 'inline-block',
    textAlign: 'right',
    color: '#333',
    fontWeight: 500,
  },
};

const buttonStyle = (loading, color) => ({
  padding: '8px 12px',
  borderRadius: 14,
  border: 'none',
  background: loading
    ? 'linear-gradient(90deg,#bfc2c7 60%,#e0e1e3 100%)'
    : color || 'linear-gradient(90deg,#888 60%,#bfc2c7 100%)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: 1,
  boxShadow: '0 2px 8px rgba(120,120,120,0.08)',
  cursor: loading ? 'not-allowed' : 'pointer',
  whiteSpace: 'nowrap',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
});

// ─── SearchBar ────────────────────────────────────────────────────────────────

/**
 * Props:
 *   radius, setRadius, fetchByAddress  — búsqueda normal
 *   heatmapActive    — boolean: hay heatmap visible
 *   heatmapLoading   — boolean: análisis en curso
 *   heatmapError     — string | null
 *   onAnalyze        — () => void  (analiza ubicación actual y guarda)
 *   onClearHeatmap   — () => void
 *   onShowHistory    — () => void  (carga el historial unificado en el mapa)
 *   hasLocation      — boolean: hay un punto seleccionado
 *
 * Flujo:
 *   1. [🛰️ Análisis de terreno]   → carga historial en el mapa
 *                                    + aparece [🗺️ Analizar ubicación actual]
 *   2. [🗺️ Analizar ubicación actual] → lanza análisis, guarda y muestra historial completo
 *   3. Mientras analiza            → spinner
 *   4. Con heatmap visible         → [🗺️ Analizar ubicación actual] + [🙈 Ocultar análisis]
 */
function SearchBar({
  radius, setRadius, fetchByAddress,
  heatmapActive, heatmapLoading, heatmapError,
  onAnalyze, onClearHeatmap, onShowHistory,
  hasLocation,
}) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  // true cuando el usuario activó el modo historial (pulsó "Análisis de terreno")
  const [historyMode, setHistoryMode] = useState(false);

  const handleSearch = async e => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetchByAddress(address);
    } catch (err) {
      alert(err.message);
    }
    setLoading(false);
  };

  // ── Bloque heatmap ──────────────────────────────────────────────────────────

  // Botón reutilizable "Analizar ubicación actual"
  const analyzeBtn = (
    <button
      type="button"
      onClick={hasLocation ? () => { onAnalyze(); } : undefined}
      disabled={!hasLocation}
      title={hasLocation ? 'Analizar la ubicación seleccionada' : 'Selecciona un punto en el mapa primero'}
      style={buttonStyle(!hasLocation, 'linear-gradient(90deg,#1565c0 60%,#42a5f5 100%)')}
    >
      🗺️ Analizar ubicación actual
    </button>
  );

  let heatmapBlock = null;

  if (heatmapLoading) {
    // Análisis en curso — spinner
    heatmapBlock = (
      <button type="button" disabled style={buttonStyle(true, 'linear-gradient(90deg,#1565c0 60%,#42a5f5 100%)')}>
        <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
        Analizando…
      </button>
    );
  } else if (heatmapActive) {
    // Heatmap visible → siempre mostrar ambos botones
    heatmapBlock = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {analyzeBtn}
        <button
          type="button"
          onClick={() => { onClearHeatmap(); setHistoryMode(false); }}
          style={buttonStyle(false, 'linear-gradient(90deg,#546e7a 60%,#90a4ae 100%)')}
        >
          Ocultar análisis
        </button>
      </div>
    );
  } else {
    // Estado base: "Análisis de terreno" carga el historial + aparece "Analizar ubicación actual"
    heatmapBlock = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => { setHistoryMode(true); onShowHistory(); }}
          style={buttonStyle(false, 'linear-gradient(90deg,#37474f 60%,#78909c 100%)')}
        >
          🛰️ Análisis de terreno
        </button>
        {historyMode && analyzeBtn}
      </div>
    );
  }

  return (
    <form className="search-responsive-form" onSubmit={handleSearch} style={styles.form}>
      <input
        type="text"
        value={address}
        onChange={e => setAddress(e.target.value)}
        placeholder="Introduce una dirección..."
        style={styles.input}
      />
      <button type="submit" disabled={loading} style={buttonStyle(loading)}>
        {loading ? 'Buscando...' : 'Buscar'}
      </button>
      <label style={styles.label}>
        Radio:
        <input
          type="range"
          min={100} max={1000} step={50}
          value={radius}
          onChange={e => setRadius(Number(e.target.value))}
          style={styles.range}
        />
        <span style={styles.rangeValue}>{radius} m</span>
      </label>
      {heatmapBlock}
      {heatmapError && (
        <span style={{ fontSize: 12, color: '#c62828', whiteSpace: 'nowrap' }}>
          ⚠️ {heatmapError}
        </span>
      )}
    </form>
  );
}

export default SearchBar;
