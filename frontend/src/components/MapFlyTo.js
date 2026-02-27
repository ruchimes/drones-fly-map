import { useMap } from 'react-leaflet';
import { useEffect } from 'react';

export default function MapFlyTo({ location }) {
  const map = useMap();

  useEffect(() => {
    if (location && location.lat && location.lon) {
      map.flyTo([location.lat, location.lon], map.getZoom(), { duration: 1.2 });
    }
  }, [location, map]);

  return null;
}
