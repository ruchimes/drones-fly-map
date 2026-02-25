# Backend - Drones España

API proxy para la app de zonas de vuelo de drones en España.

## Endpoints

- `/api/geocode?address=...` — Geocodifica una dirección (usa Nominatim)
- `/api/zones?lat=...&lon=...` — Consulta zonas UAS de ENAIRE a 1km del punto

## Uso

```
cd backend
npm install
npm start
```

El backend corre en el puerto 4000 por defecto.
