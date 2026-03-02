
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

const buttonStyle = loading => ({
  padding: '8px 8px',
  borderRadius: 14,
  border: 'none',
  background: loading
    ? 'linear-gradient(90deg,#bfc2c7 60%,#e0e1e3 100%)'
    : 'linear-gradient(90deg,#888 60%,#bfc2c7 100%)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: 1,
  boxShadow: '0 2px 8px rgba(120,120,120,0.08)',
  cursor: loading ? 'not-allowed' : 'pointer',
});

// ─── SearchBar ────────────────────────────────────────────────────────────────

/**
 * Props:
 *   radius, setRadius, fetchByAddress  — búsqueda normal
 *   heatmapActive    — boolean: hay heatmap visible
 *   heatmapLoading   — boolean: análisis en curso
 *   heatmapError     — string | null
 *   onAnalyze        — () => void
 *   onClearHeatmap   — () => void
 *   hasLocation      — boolean: hay un punto seleccionado
 */
function SearchBar({
  radius, setRadius, fetchByAddress,
  heatmapActive, heatmapLoading, heatmapError,
  onAnalyze, onClearHeatmap, hasLocation,
}) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

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

  // Botón del heatmap: solo visible cuando hay punto seleccionado
  const heatmapBtn = hasLocation ? (
    heatmapLoading ? (
      <button type="button" disabled style={{
        ...buttonStyle(true),
        background: 'linear-gradient(90deg,#1565c0 60%,#42a5f5 100%)',
        display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
      }}>
        <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
        Analizando…
      </button>
    ) : heatmapActive ? (
      <button type="button" onClick={onClearHeatmap} style={{
        ...buttonStyle(false),
        background: 'linear-gradient(90deg,#c62828 60%,#ef9a9a 100%)',
        whiteSpace: 'nowrap',
      }}>
        ✕ Limpiar mapa
      </button>
    ) : (
      <button type="button" onClick={onAnalyze} style={{
        ...buttonStyle(false),
        background: 'linear-gradient(90deg,#1565c0 60%,#42a5f5 100%)',
        whiteSpace: 'nowrap',
      }}>
        🗺️ Analizar zona
      </button>
    )
  ) : null;

  return (
    <form className="search-responsive-form" onSubmit={handleSearch} style={styles.form}>
      <input
        type="text"
        value={address}
        onChange={e => setAddress(e.target.value)}
        placeholder="Introduce una dirección..."
        style={styles.input}
      />
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
      <button type="submit" disabled={loading} style={buttonStyle(loading)}>
        {loading ? 'Buscando...' : 'Buscar'}
      </button>
      {heatmapBtn}
      {heatmapError && (
        <span style={{ fontSize: 12, color: '#c62828', whiteSpace: 'nowrap' }}>
          ⚠️ {heatmapError}
        </span>
      )}
    </form>
  );
}

export default SearchBar;
