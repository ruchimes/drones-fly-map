import React from 'react';

/**
 * Panel flotante de controles del heatmap.
 *
 * Props:
 *   active        — boolean: heatmap activo
 *   loading       — boolean: análisis en curso
 *   error         — string | null
 *   onAnalyze     — () => void: lanza el análisis
 *   onClear       — () => void: limpia el heatmap
 *   hasLocation   — boolean: hay un punto seleccionado
 */
function HeatmapControls({ active, loading, error, onAnalyze, onClear, hasLocation }) {
  const btnBase = {
    border: 'none',
    borderRadius: 14,
    padding: '8px 16px',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  };

  if (!hasLocation) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {!active && !loading && (
        <button
          style={{
            ...btnBase,
            background: 'linear-gradient(135deg, #1565c0, #1976d2)',
            color: '#fff',
            boxShadow: '0 2px 6px rgba(25,118,210,0.35)',
          }}
          onClick={onAnalyze}
          title="Analizar zona en cuadrícula de 100m"
        >
          🗺️ Analizar zona
        </button>
      )}

      {loading && (
        <div style={{
          ...btnBase,
          background: 'rgba(33,150,243,0.12)',
          color: '#1565c0',
          border: '1.5px solid #90caf9',
          cursor: 'default',
        }}>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
          Analizando…
        </div>
      )}

      {active && !loading && (
        <button
          style={{
            ...btnBase,
            background: 'rgba(244,67,54,0.1)',
            color: '#c62828',
            border: '1.5px solid #ef9a9a',
          }}
          onClick={onClear}
          title="Limpiar análisis"
        >
          ✕ Limpiar mapa
        </button>
      )}

      {error && (
        <span style={{
          fontSize: 12,
          color: '#c62828',
          background: 'rgba(244,67,54,0.08)',
          borderRadius: 8,
          padding: '4px 10px',
          border: '1px solid #ef9a9a',
        }}>
          ⚠️ {error}
        </span>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default HeatmapControls;
