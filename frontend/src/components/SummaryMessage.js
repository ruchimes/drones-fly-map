import React from 'react';

export default function SummaryMessage({ canFly, maxAllowedHeight, reasons, onClose }) {
  if (canFly === null) return null;
  return (
    <div style={{position:'absolute',top:60,left:10,zIndex:1200,minWidth:320,maxWidth:400,background:'#fff',borderRadius:8,boxShadow:'0 2px 8px #0002',padding:16,display:'block'}}>
      <button
        onClick={onClose}
        style={{position:'absolute',top:8,right:12,border:'none',background:'none',fontSize:22,cursor:'pointer',color:'#888'}}
        aria-label="Cerrar"
        title="Cerrar"
      >×</button>
      <div style={{paddingRight:24}}>
        <b>¿Se puede volar?</b><br/>
        <span style={{color: canFly ? 'green' : 'red', fontWeight:'bold'}}>
          {canFly ? 'SÍ' : 'NO'}
        </span>
        {canFly && maxAllowedHeight && (
          <div style={{marginTop:8, color:'#1976d2', fontWeight:'bold'}}>
            Altura máxima permitida: {maxAllowedHeight} m
          </div>
        )}
        <ul style={{marginTop:8}}>
          {reasons.map((r,i) => <li key={i}>{r}</li>)}
        </ul>
      </div>
    </div>
  );
}