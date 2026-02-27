import React from 'react';

export default function SummaryMessage({ canFly, maxAllowedHeight, reasons, onClose }) {
  if (canFly === null) return null;

  const containerStyle = {
    position: 'absolute',
    top: 60,
    left: 10,
    zIndex: 1200,
    minWidth: 180,
    maxWidth: '90vw',
    background: '#fff',
    borderRadius: 8,
    boxShadow: '0 2px 8px #0002',
    padding: 16,
    display: 'block',
    pointerEvents: 'auto',
    marginRight: '10px',
  };

  const closeBtnStyle = {
    position: 'absolute',
    top: 8,
    right: 12,
    border: 'none',
    background: 'none',
    fontSize: 22,
    cursor: 'pointer',
    color: '#888',
  };

  const statusStyle = {
    color: canFly ? 'green' : 'red',
    fontWeight: 'bold',
  };

  const maxHeightStyle = {
    marginTop: 8,
    color: '#1976d2',
    fontWeight: 'bold',
  };

  const listStyle = {
    marginTop: 8,
  };

  return (
    <div style={containerStyle} onClick={e => e.stopPropagation()}>
      <button
        onClick={e => { e.stopPropagation(); onClose && onClose(); }}
        style={closeBtnStyle}
        aria-label="Cerrar"
        title="Cerrar"
      >×</button>
      <div style={{ paddingRight: 24 }}>
        <b>¿Se puede volar?</b><br />
        <span style={statusStyle}>{canFly ? 'SÍ' : 'NO'}</span>
        {canFly && maxAllowedHeight && (
          <div style={maxHeightStyle}>
            Altura máxima permitida: {maxAllowedHeight} m
          </div>
        )}
        <ul style={listStyle}>
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}