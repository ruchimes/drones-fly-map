
import React, { useRef, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Polygon, Popup, useMapEvents } from 'react-leaflet';
import MapFlyTo from './MapFlyTo';


const colorByRestriction = (zone) => {
  if (zone.prohibited) return 'red';
  if (zone.maxHeight) return 'orange';
  if (zone.warning) return 'yellow';
  return 'green';
};


function MapClickHandler({ onMapClick }) {
  // Usar ref para evitar closure stale: siempre apunta a la función más reciente
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);

  useMapEvents({
    click(e) {
      if (onMapClickRef.current) {
        onMapClickRef.current(e.latlng);
      }
    }
  });
  return null;
}

function MapView({ location, zones, radius=1000, onMapClick }) {
  const center = location ? [location.lat, location.lon] : [40.4168, -3.7038]; // Madrid por defecto
  const mapStyle = { height: '100vh', width: '100vw' };
  const popupNameStyle = { fontWeight: 'bold' };
  const prohibitedStyle = { color: 'red' };
  const maxHeightStyle = { color: 'orange' };
  const warningStyle = { color: 'goldenrod' };
  const noRestrictionStyle = { color: 'green' };
  return (
    <MapContainer center={center} zoom={14} style={mapStyle} zoomControl={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapFlyTo location={location} />
      <MapClickHandler onMapClick={onMapClick} />
      {location && <Marker position={[location.lat, location.lon]} />}
      {location && <Circle center={[location.lat, location.lon]} radius={radius} color="blue" />}
      {zones.map((zone, i) => {
        if (!zone.geometry || zone.geometry.length < 3) return null;
        // Ocultar popups de restricciones de altura absurdas (>120m)
        const showMaxHeight = zone.maxHeight && Number(zone.maxHeight) <= 120;
        return (
          <Polygon key={i} positions={zone.geometry} pathOptions={{ color: colorByRestriction(zone), interactive: false, fillOpacity: 0.2 }}>
            {(zone.prohibited || showMaxHeight || zone.warning || (!zone.prohibited && !zone.maxHeight && !zone.warning)) && (
              <Popup>
                <div>
                  <b style={popupNameStyle}>{zone.name}</b><br/>
                  {zone.prohibited && <span style={prohibitedStyle}>Prohibido volar drones aquí.<br/></span>}
                  {showMaxHeight && <span style={maxHeightStyle}>No volar a más de {zone.maxHeight}m.<br/></span>}
                  {zone.warning && <span style={warningStyle}>Aviso:<br/><span dangerouslySetInnerHTML={{__html: zone.warning}} /></span>}
                  {!zone.prohibited && !zone.maxHeight && !zone.warning && <span style={noRestrictionStyle}>Sin restricciones.<br/></span>}
                </div>
              </Popup>
            )}
          </Polygon>
        );
      })}
    </MapContainer>
  );
}

export default MapView;
