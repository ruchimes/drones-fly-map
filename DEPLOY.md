# 🚀 Despliegue en producción

## Arquitectura

```
Vercel (frontend React)  ──→  Render (backend Node.js/Express)  ──→  ENAIRE API
                                        ↓
                               S3 Amazon (tiles SRTM, bajo demanda)
```

---

## 1. Backend → Render (gratis)

### Primer despliegue

1. Ve a [render.com](https://render.com) y crea una cuenta (gratis).
2. **New → Web Service** → conecta tu repositorio de GitHub.
3. Configura:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
   - **Plan**: Free
4. Pulsa **Deploy**.
5. Render te dará una URL del tipo `https://drones-app-backend.onrender.com`. Cópiala.

> ⚠️ En el plan gratuito de Render, el servicio se **duerme** tras 15 min de inactividad y tarda ~30s en despertar en la primera petición.

---

## 2. Frontend → Vercel (gratis)

### Primer despliegue

1. Ve a [vercel.com](https://vercel.com) y crea una cuenta (gratis).
2. **New Project** → importa el repositorio → en **Root Directory** pon `frontend`.
3. En **Environment Variables** añade:
   ```
   REACT_APP_API_URL = https://drones-app-backend.onrender.com
   ```
   (usa la URL que Render te dio en el paso anterior, **sin barra final**)
4. Pulsa **Deploy**.
5. Vercel te dará una URL del tipo `https://drones-app.vercel.app`.

---

## 3. Desarrollo local

No se necesita ninguna variable de entorno. El proxy de `setupProxy.js` redirige `/api/*` → `http://localhost:4000`.

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm start
```

---

## Notas sobre los tiles SRTM

- Los 188 tiles (~4.65 GB) están en `backend/srtm_cache/` y **no se suben a git** (`.gitignore`).
- En producción hay tres opciones:

### Opción A — Render Disk ($1/mes) ⭐ Recomendada
El `render.yaml` ya incluye un disco persistente de 5 GB montado en `/data`.  
Tras el primer despliegue, descarga todos los tiles **una sola vez**:
```bash
curl https://TU-APP.onrender.com/api/warmup-srtm
```
Puede tardar ~10-15 min. Los tiles quedan en `/data/srtm_cache/` y **sobreviven a reinicios**.

### Opción B — Sin disco (gratis)
Elimina la sección `disk:` del `render.yaml`.  
Los tiles se descargan de Amazon S3 automáticamente en la primera consulta de cada zona.  
Se re-descargan en cada reinicio del servicio (~30s de latencia la primera vez).

### Opción C — Desarrollo local
```bash
cd backend && npm run download-srtm  # descarga los 188 tiles (~20 min, ~4.65 GB)
```
