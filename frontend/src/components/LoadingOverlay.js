import React from 'react';

/**
 * Overlay de carga genérico (spinner azul).
 * Se muestra mientras loading === true (consulta de zona puntual).
 */
export default function LoadingOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(255,255,255,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000,
    }}>
      <svg width="60" height="60" viewBox="0 0 44 44" stroke="#1976d2">
        <g fill="none" fillRule="evenodd" strokeWidth="4">
          <circle cx="22" cy="22" r="18" strokeOpacity=".5" />
          <path d="M40 22c0-9.94-8.06-18-18-18">
            <animateTransform
              attributeName="transform" type="rotate"
              from="0 22 22" to="360 22 22"
              dur="1s" repeatCount="indefinite"
            />
          </path>
        </g>
      </svg>
    </div>
  );
}
