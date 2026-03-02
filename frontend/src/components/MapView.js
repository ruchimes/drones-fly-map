
import React, { useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Polygon, Popup, useMapEvents } from 'react-leaflet';
import MapFlyTo from './MapFlyTo';
import HeatmapLayer from './HeatmapLayer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ZONE_COLORS = { prohibited: 'red', maxHeight: 'orange', warning: 'yellow', default: 'green' };

const zoneColor = zone => {
  if (zone.prohibited) return ZONE_COLORS.prohibited;
  if (zone.maxHeight)  return ZONE_COLORS.maxHeight;
  if (zone.warning)    return ZONE_COLORS.warning;
  return ZONE_COLORS.default;
};

// ─── MapClickHandler ──────────────────────────────────────────────────────────

/** Captura clicks del mapa y los reenvía a onMapClick, sin problemas de closure stale.
 *  Ignora el click si `cellClickedRef.current` está activo (la celda ya lo procesó). */
function MapClickHandler({ onMapClick, cellClickedRef }) {
  const callbackRef = useRef(onMapClick);
  useEffect(() => { callbackRef.current = onMapClick; }, [onMapClick]);
  useMapEvents({
    click: e => {
      // Si el click vino de una celda del heatmap, ignorarlo aquí
      if (cellClickedRef?.current) {
        cellClickedRef.current = false;
        return;
      }
      callbackRef.current?.(e.latlng);
    },
  });
  return null;
}

// ─── ZonePolygon ──────────────────────────────────────────────────────────────

function ZonePolygon({ zone }) {
  if (!zone.geometry || zone.geometry.length < 3) return null;

  const showMaxHeight = zone.maxHeight && Number(zone.maxHeight) <= 120;
  const color = zoneColor(zone);

  return (
    <Polygon
      positions={zone.geometry}
      pathOptions={{ color, interactive: false, fillOpacity: 0.2 }}
    >
      <Popup>
        <b>{zone.name}</b><br />
        {zone.prohibited  && <span style={{ color: 'red' }}>Prohibido volar drones aquí.<br /></span>}
        {showMaxHeight    && <span style={{ color: 'orange' }}>No volar a más de {zone.maxHeight}m.<br /></span>}
        {zone.warning     && <span style={{ color: 'goldenrod' }}>Aviso:<br /><span dangerouslySetInnerHTML={{ __html: zone.warning }} /></span>}
        {!zone.prohibited && !zone.maxHeight && !zone.warning && <span style={{ color: 'green' }}>Sin restricciones.<br /></span>}
      </Popup>
    </Polygon>
  );
}

// ─── MapView ──────────────────────────────────────────────────────────────────

const DEFAULT_CENTER = [40.4168, -3.7038]; // Madrid

function MapView({ location, zones = [], radius = 1000, onMapClick, heatmap = null, onHeatmapCellClick }) {
  const center = location ? [location.lat, location.lon] : DEFAULT_CENTER;
  // Flag compartido: HeatmapLayer lo activa, MapClickHandler lo consume
  const cellClickedRef = useRef(false);

  return (
    <MapContainer center={center} zoom={14} style={{ height: '100vh', width: '100vw' }} zoomControl={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapFlyTo location={location} />
      <MapClickHandler onMapClick={onMapClick} cellClickedRef={cellClickedRef} />

      {/* Heatmap de cuadrícula (se muestra debajo de zonas y marcadores) */}
      <HeatmapLayer heatmap={heatmap} onCellClick={onHeatmapCellClick} cellClickedRef={cellClickedRef} />

      {location && (
        <Marker
          position={[location.lat, location.lon]}
          eventHandlers={{
            click: () => { cellClickedRef.current = true; },
          }}
        />
      )}
      {location && <Circle center={[location.lat, location.lon]} radius={radius} color="blue" pathOptions={{ interactive: false }} />}

      {zones.map((zone, i) => <ZonePolygon key={i} zone={zone} />)}
    </MapContainer>
  );
}

export default MapView;
