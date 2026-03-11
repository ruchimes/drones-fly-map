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

// ─── UrbanBadge ───────────────────────────────────────────────────────────────

/**
 * Muestra aviso de zona urbana SOLO cuando se puede volar (canFly=true),
 * isUrban===true y confidence no es 'low'.
 * Si el vuelo ya está prohibido por otra restricción, el badge no aporta
 * información accionable y se omite.
 */
function UrbanBadge({ urban, enabled }) {
  if (!enabled) return null;
  if (!urban || urban.isUrban !== true) return null;
  if (urban.confidence === 'low') return null;

  return (
    <div style={{
      marginTop: 10,
      padding: '7px 10px',
      background: '#fff3cd',
      border: '1px solid #ffc107',
      borderRadius: 6,
      fontSize: 13,
      color: '#856404',
    }}>
      🏙️ <strong>Zona urbana</strong> — comunica el vuelo al <strong>Ministerio del Interior</strong> con <strong>5 días naturales</strong> de antelación.{' '}
      <a
        href="https://sede.interior.gob.es/portal/sede/tramites?idAgrupacion=17"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#856404', fontWeight: 'bold', textDecoration: 'underline' }}
      >
        Tramitar aquí
      </a>
      {urban.confidence === 'medium' && (
        <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: '#9a7200' }}>
          (detección aproximada — verifica antes de volar)
        </span>
      )}
      {urban.reason && (
        <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: '#9a7200', fontStyle: 'italic' }}>
          Detectado: {urban.reason}
        </span>
      )}
    </div>
  );
}

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

export default function SummaryMessage({ canFly, maxAllowedHeight, reasons, urban, urbanEnabled, onToggleUrban, onClose }) {
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

        <UrbanBadge urban={canFly ? urban : null} enabled={urbanEnabled} />

        {/* Toggle detección urbana */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#555' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={!!urbanEnabled}
              onChange={onToggleUrban}
              style={{ cursor: 'pointer', accentColor: '#856404', width: 14, height: 14 }}
            />
            Detección de zona urbana
          </label>
        </div>

        {reasons?.length > 0 && (
          <ul style={{ marginTop: 8 }}>
            {reasons.map((r, i) => <li key={i}>{renderReason(r)}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
