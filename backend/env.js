/**
 * env.js — Carga .env antes que cualquier otro módulo.
 * Importar SIEMPRE como primer import en el punto de entrada.
 * En producción (Render) no existe .env y las vars vienen del entorno del sistema.
 */
import { loadEnvFile } from 'node:process';
try {
  loadEnvFile(new URL('.env', import.meta.url));
} catch {
  // Sin .env — se asume que las variables ya están en process.env (producción)
}
