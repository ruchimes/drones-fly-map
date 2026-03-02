/**
 * Base URL para todas las llamadas al backend.
 * - En desarrollo: vacío → el proxy de setupProxy.js redirige /api → localhost:4000
 * - En producción: REACT_APP_API_URL debe apuntar al backend de Render,
 *   ej: https://drones-app-backend.onrender.com
 */
const API_BASE = process.env.REACT_APP_API_URL || '';

export default API_BASE;
