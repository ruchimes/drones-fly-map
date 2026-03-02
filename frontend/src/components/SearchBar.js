
import React, { useState } from 'react';
import axios from 'axios';

function SearchBar({ setLocation, setZones, setLoadingZones, setSummary, radius, setRadius }) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLoadingZones && setLoadingZones(true);
    try {
      const geoRes = await axios.get(`/api/geocode?address=${encodeURIComponent(address)}`);
      setLocation(geoRes.data.location);
      const zonesRes = await axios.get(`/api/zones?lat=${geoRes.data.location.lat}&lon=${geoRes.data.location.lon}&radius=${radius}`);
      setZones(Array.isArray(zonesRes.data.zones) ? zonesRes.data.zones : []);
      setSummary && setSummary({ canFly: zonesRes.data.canFly, reasons: zonesRes.data.reasons, maxAllowedHeight: zonesRes.data.maxAllowedHeight });
    } catch (err) {
      alert('No se pudo encontrar la dirección o zonas.');
      setZones([]);
      setSummary && setSummary(null);
    }
    setLoading(false);
    setLoadingZones && setLoadingZones(false);
  };

  // Estilos extraídos
  const formStyle = {
    padding: 10,
    background: 'transparent',
    zIndex: 1000,
    width: '100%',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  };
  const inputStyle = {
    width: 220,
    padding: '8px 14px',
    border: '1.5px solid #c0c4cc',
    borderRadius: 14,
    background: 'rgba(245,245,247,0.85)',
    color: '#222',
    fontSize: 15,
    outline: 'none',
    transition: 'border 0.2s',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  };
  const labelStyle = {
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: '#555',
    background: 'rgba(240,240,240,0.7)',
    borderRadius: 10,
    padding: '4px 10px',
  };
  const rangeStyle = {
    width: 100,
    accentColor: '#888',
    background: 'transparent',
    borderRadius: 8,
  };
  const spanStyle = {
    minWidth: 44,
    display: 'inline-block',
    textAlign: 'right',
    color: '#333',
    fontWeight: 500,
  };
  const buttonStyle = {
    padding: '8px 8px',
    borderRadius: 14,
    border: 'none',
    background: loading ? 'linear-gradient(90deg,#bfc2c7 60%,#e0e1e3 100%)' : 'linear-gradient(90deg,#888 60%,#bfc2c7 100%)',
    color: '#fff',
    fontWeight: 600,
    fontSize: 12,
    letterSpacing: 1,
    boxShadow: '0 2px 8px rgba(120,120,120,0.08)',
    cursor: loading ? 'not-allowed' : 'pointer',
    transition: 'background 0.2s, box-shadow 0.2s',
  };

  return (
    <form className="search-responsive-form" onSubmit={handleSearch} style={formStyle}>
      <input
        type="text"
        value={address}
        onChange={e => setAddress(e.target.value)}
        placeholder="Introduce una dirección..."
        style={inputStyle}
      />
      <label style={labelStyle}>
        Radio:
        <input
          type="range"
          min={100}
          max={1000}
          step={50}
          value={radius}
          onChange={e => setRadius(Number(e.target.value))}
          style={rangeStyle}
        />
        <span style={spanStyle}>{radius} m</span>
      </label>
      <button
        type="submit"
        disabled={loading}
        style={buttonStyle}
      >
        {loading ? 'Buscando...' : 'Buscar'}
      </button>
    </form>
  );
}

export default SearchBar;
