import React from 'react';

/**
 * Overlay de progreso del análisis de heatmap.
 * Se muestra mientras heatmapLoading === true.
 *
 * Props:
 *   progress — { phase, done, total } | null
 */
export default function HeatmapProgress({ progress }) {
  const isElevation = progress?.phase === 'elevaciones';
  const pct = progress && !isElevation
    ? Math.round((progress.done / progress.total) * 100)
    : null;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(255,255,255,0.55)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      zIndex: 2000,
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
        {/* Título */}
        <div style={{ marginBottom: 10 }}>
          {isElevation ? '🏔️ Consultando elevaciones del terreno…' : '🗺️ Analizando cuadrícula…'}
        </div>

        {/* Barra de progreso */}
        <div style={{
          width: '100%', height: 18, borderRadius: 9,
          background: '#f0f0f0', overflow: 'hidden',
          border: '1px solid #ddd', marginBottom: 8,
        }}>
          <div style={{
            height: '100%', borderRadius: 9,
            background: isElevation
              ? 'linear-gradient(90deg, #42a5f5, #1565c0)'
              : 'linear-gradient(90deg, #81c784, #43a047)',
            width: pct != null ? `${pct}%` : isElevation ? '15%' : '0%',
            transition: 'width 0.3s ease',
          }} />
        </div>

        {/* Texto de estado */}
        <div style={{ fontWeight: 400, fontSize: 13, color: '#555' }}>
          {isElevation
            ? 'Obteniendo alturas del terreno…'
            : pct != null
              ? `${progress.done} / ${progress.total} celdas (${pct}%)`
              : 'Iniciando…'}
        </div>
      </div>
    </div>
  );
}
