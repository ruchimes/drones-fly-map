import React from 'react';

// ─── Estilos ──────────────────────────────────────────────────────────────────

const containerStyle = canFly => ({
  position: 'absolute',
  top: 60, left: 10,
  zIndex: 1200,
  minWidth: 180,
  maxWidth: '90vw',
  background: canFly ? '#a1dda6ff' : '#edadb6ff',
  borderRadius: 8,
  boxShadow: '0 2px 8px #0002',
  padding: 16,
  pointerEvents: 'auto',
  marginRight: 10,
});

const closeBtnStyle = {
  position: 'absolute',
  top: 8, right: 12,
  border: 'none',
  background: 'none',
  fontSize: 22,
  cursor: 'pointer',
  color: '#888',
};

const statusStyle = canFly => ({
  color: canFly ? 'green' : 'red',
  fontWeight: 'bold',
  fontSize: 22,
});

// ─── SummaryMessage ───────────────────────────────────────────────────────────

/**
 * Convierte **texto** en <strong>texto</strong> para los avisos NO AIP y otros reasons.
 * El resto del texto se muestra como texto plano.
 */
function renderReason(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export default function SummaryMessage({ canFly, maxAllowedHeight, reasons, onClose }) {
  if (canFly === null) return null;

  return (
    <div style={containerStyle(canFly)} onClick={e => e.stopPropagation()}>
      <button
        onClick={e => { e.stopPropagation(); onClose?.(); }}
        style={closeBtnStyle}
        aria-label="Cerrar"
        title="Cerrar"
      >×</button>

      <div style={{ paddingRight: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <b>¿Se puede volar?</b>
          <span style={statusStyle(canFly)}>{canFly ? 'SÍ' : 'NO'}</span>
        </div>

        {canFly && maxAllowedHeight && (
          <div style={{ marginTop: 8, color: '#1976d2', fontWeight: 'bold' }}>
            Altura máxima permitida: {maxAllowedHeight} m
          </div>
        )}

        <ul style={{ marginTop: 8 }}>
          {reasons.map((r, i) => <li key={i}>{renderReason(r)}</li>)}
        </ul>
      </div>
    </div>
  );
}
