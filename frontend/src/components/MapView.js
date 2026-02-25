
import React from 'react';
import { MapContainer, TileLayer, Marker, Circle, Polygon, Popup, useMapEvents } from 'react-leaflet';


const colorByRestriction = (zone) => {
  if (zone.prohibited) return 'red';
  if (zone.maxHeight) return 'orange';
  if (zone.warning) return 'yellow';
  return 'green';
};


function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick(e.latlng);
      }
    }
  });
  return null;
}

function MapView({ location, zones, radius=1000, onMapClick }) {
  const center = location ? [location.lat, location.lon] : [40.4168, -3.7038]; // Madrid por defecto
  return (
    <MapContainer center={center} zoom={14} style={{ height: '90vh', width: '100vw' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapClickHandler onMapClick={onMapClick} />
      {location && <Marker position={[location.lat, location.lon]} />}
      {location && <Circle center={[location.lat, location.lon]} radius={radius} color="blue" />}
      {zones.map((zone, i) => {
        // Ocultar popups de restricciones de altura absurdas (>120m)
        const showMaxHeight = zone.maxHeight && Number(zone.maxHeight) <= 120;
        return (
          <Polygon key={i} positions={zone.geometry} color={colorByRestriction(zone)}>
            {(zone.prohibited || showMaxHeight || zone.warning || (!zone.prohibited && !zone.maxHeight && !zone.warning)) && (
              <Popup>
                <div>
                  <b>{zone.name}</b><br/>
                  {zone.prohibited && <span style={{color:'red'}}>Prohibido volar drones aquí.<br/></span>}
                  {showMaxHeight && <span style={{color:'orange'}}>No volar a más de {zone.maxHeight}m.<br/></span>}
                  {zone.warning && <span style={{color:'goldenrod'}}>Aviso:<br/><span dangerouslySetInnerHTML={{__html: zone.warning}} /></span>}
                  {!zone.prohibited && !zone.maxHeight && !zone.warning && <span style={{color:'green'}}>Sin restricciones.<br/></span>}
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
