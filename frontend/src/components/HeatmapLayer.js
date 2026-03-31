import React, { useMemo } from 'react';
import { Rectangle, Tooltip } from 'react-leaflet';

// ─── Paleta de colores ────────────────────────────────────────────────────────

/**
 * Devuelve el color de relleno de una celda según su estado de vuelo.
 *
 *  fetchError=true                       → naranja oscuro (error al analizar — reintentar)
 *  canFly=true, maxAllowedHeight >= 120  → verde oscuro  (libre hasta 120m)
 *  canFly=true, maxAllowedHeight >= 60   → verde claro   (libre hasta Xm)
 *  canFly=true, maxAllowedHeight > 0     → amarillo      (límite de altura bajo)
 *  canFly=false                          → rojo          (prohibido)
 *  canFly=null                           → gris          (sin datos)
 */
function cellColor(canFly, maxAllowedHeight, fetchError) {
  if (fetchError)                         return { fill: '#ef6c00', stroke: '#bf360c' };
  if (canFly === null || canFly === undefined) return { fill: '#9e9e9e', stroke: '#757575' };
  if (!canFly)                            return { fill: '#f44336', stroke: '#c62828' };
  const h = maxAllowedHeight ?? 120;
  if (h >= 120)  return { fill: '#43a047', stroke: '#2e7d32' };
  if (h >= 60)   return { fill: '#8bc34a', stroke: '#558b2f' };
  if (h >= 30)   return { fill: '#ffee58', stroke: '#f9a825' };
  return           { fill: '#ff9800', stroke: '#e65100' };
}

/**
 * Leyenda de colores del heatmap.
 */
export function HeatmapLegend({ onClose }) {
  const items = [
    { color: '#43a047', label: 'Libre hasta 120m' },
    { color: '#8bc34a', label: 'Libre hasta 60–119m' },
    { color: '#ffee58', label: 'Libre hasta 30–59m' },
    { color: '#ff9800', label: 'Libre hasta <30m' },
    { color: '#f44336', label: 'Prohibido / restringido' },
    { color: '#ef6c00', label: 'Error al analizar (reintentar)' },
    { color: '#9e9e9e', label: 'Sin datos' },
  ];

  return (
    <div style={{
      background: 'rgba(255,255,255,0.93)',
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      minWidth: 190,
      pointerEvents: 'auto',
      position: 'relative',
    }}>
      {onClose && (
        <button onClick={onClose} style={{
          position: 'absolute', top: 6, right: 8,
          border: 'none', background: 'none',
          fontSize: 18, cursor: 'pointer', color: '#888',
          lineHeight: 1, padding: 0,
        }} aria-label="Cerrar leyenda">×</button>
      )}
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 7, color: '#333', paddingRight: onClose ? 18 : 0 }}>
        🗺️ Mapa de vuelo
      </div>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{
            width: 18, height: 14, borderRadius: 3,
            background: color, border: '1px solid rgba(0,0,0,0.15)',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, color: '#444' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── HeatmapLayer ─────────────────────────────────────────────────────────────

// Misma latitud de referencia que usa buildGrid en el backend
const GRID_REF_LAT = 40.0;

/**
 * Renderiza la capa de celdas del heatmap sobre el mapa Leaflet.
 *
 * Props:
 *   heatmap      — objeto { cellM, cells: [{ lat, lon, canFly, maxAllowedHeight, terrainElevation, reasons, zoneNames }] }
 *   onCellClick  — (cell) => void  (opcional)
 */
function HeatmapLayer({ heatmap, onCellClick, cellClickedRef }) {
  // Tamaño de celda en grados usando la misma referencia fija que el backend
  const { cellDegLat, cellDegLon } = useMemo(() => {
    if (!heatmap?.cells?.length) return { cellDegLat: 0, cellDegLon: 0 };
    const cellKm = heatmap.cellM / 1000;
    const degLat = cellKm / 111;
    const degLon = cellKm / (111 * Math.cos((GRID_REF_LAT * Math.PI) / 180));
    return { cellDegLat: degLat, cellDegLon: degLon };
  }, [heatmap]);

  if (!heatmap?.cells?.length) return null;

  const half_lat = cellDegLat / 2;
  const half_lon = cellDegLon / 2;

  return (
    <>
      {heatmap.cells.map((cell) => {
        const { fill, stroke } = cellColor(cell.canFly, cell.maxAllowedHeight, cell.fetchError);
        const bounds = [
          [cell.lat - half_lat, cell.lon - half_lon],
          [cell.lat + half_lat, cell.lon + half_lon],
        ];

        const label = cell.fetchError
          ? '⚠️ Error al analizar (vuelve a analizar esta zona)'
          : cell.canFly === false
            ? '🚫 Prohibido / restringido'
            : cell.canFly === true
              ? `✅ Libre hasta ${cell.maxAllowedHeight ?? 120}m`
              : '❓ Sin datos';

        // Key por posición → React destruye y recrea el rectángulo si cambia la celda,
        // evitando que se acumulen capas solapadas de análisis distintos
        const key = `${cell.lat.toFixed(6)},${cell.lon.toFixed(6)}`;

        return (
          <Rectangle
            key={key}
            bounds={bounds}
            pathOptions={{
              color:       stroke,
              fillColor:   fill,
              fillOpacity: 0.52,
              weight:      0.5,
            }}
            eventHandlers={onCellClick ? {
              click: e => {
                e.originalEvent?.stopPropagation();
                if (cellClickedRef) cellClickedRef.current = Date.now(); // timestamp para filtrar en MapClickHandler
                onCellClick(cell);
              },
            } : {}}
          >
            <Tooltip sticky direction="top" offset={[0, -4]}>
              <div style={{ fontSize: 12, maxWidth: 220, wordBreak: 'break-word' }}>
                <b>{label}</b>
                {cell.terrainElevation != null && (
                  <div style={{ color: '#555', marginTop: 2 }}>
                    🏔️ Terreno: {cell.terrainElevation}m AMSL
                  </div>
                )}
                {cell.zoneNames?.length > 0 && (
                  <div style={{ color: '#555', marginTop: 2 }}>
                    📍 {cell.zoneNames.slice(0, 2).join(', ')}{cell.zoneNames.length > 2 ? '…' : ''}
                  </div>
                )}
                {cell.reasons?.length > 0 && (
                  <div style={{ marginTop: 4, borderTop: '1px solid #ddd', paddingTop: 3 }}>
                    {cell.reasons.slice(0, 2).map((r, ri) => (
                      <div key={ri} style={{
                        color: cell.canFly ? '#2e7d32' : '#c62828',
                        marginTop: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 210,
                      }} title={r}>
                        {r.length > 60 ? r.slice(0, 57) + '…' : r}
                      </div>
                    ))}
                    {cell.reasons.length > 2 && (
                      <div style={{ color: '#888', fontSize: 10, marginTop: 1 }}>
                        +{cell.reasons.length - 2} más — click para ver todo
                      </div>
                    )}
                  </div>
                )}
                <div style={{ color: '#999', marginTop: 3, fontSize: 10 }}>
                  {cell.lat.toFixed(5)}, {cell.lon.toFixed(5)}
                </div>
              </div>
            </Tooltip>
          </Rectangle>
        );
      })}
    </>
  );
}

export default HeatmapLayer;
