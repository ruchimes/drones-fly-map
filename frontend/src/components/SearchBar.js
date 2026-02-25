
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
      setZones(zonesRes.data.zones);
      setSummary && setSummary({ canFly: zonesRes.data.canFly, reasons: zonesRes.data.reasons });
    } catch (err) {
      alert('No se pudo encontrar la dirección o zonas.');
      setZones([]);
      setSummary && setSummary(null);
    }
    setLoading(false);
    setLoadingZones && setLoadingZones(false);
  };

  return (
    <form onSubmit={handleSearch} style={{ padding: 10, background: '#fff', zIndex: 1000, display:'flex',alignItems:'center',gap:10 }}>
      <input
        type="text"
        value={address}
        onChange={e => setAddress(e.target.value)}
        placeholder="Introduce una dirección..."
        style={{ width: 300 }}
      />
      <label style={{fontSize:14, display:'flex', alignItems:'center', gap:8 }}>
        Radio:
        <input
          type="range"
          min={100}
          max={1000}
          step={50}
          value={radius}
          onChange={e => setRadius(Number(e.target.value))}
          style={{ width: 120 }}
        />
        <span style={{minWidth:40,display:'inline-block',textAlign:'right'}}>{radius} m</span>
      </label>
      <button type="submit" disabled={loading}>Buscar</button>
    </form>
  );
}

export default SearchBar;
