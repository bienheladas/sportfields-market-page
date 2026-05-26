import * as React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Custom SVG pin — avoids the Vite/webpack image-path issue with default Leaflet icons.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32">
  <path d="M12 0C7.16 0 3.2 3.96 3.2 8.8c0 6.6 8.8 23.2 8.8 23.2s8.8-16.6 8.8-23.2C20.8 3.96 16.84 0 12 0z" fill="#ff6a4d"/>
  <circle cx="12" cy="9" r="4" fill="white"/>
</svg>`;

const customIcon = L.divIcon({
  html: PIN_SVG,
  className: '',
  iconSize: [24, 32],
  iconAnchor: [12, 32],
  popupAnchor: [0, -34],
});

export interface FieldMapProps {
  lat: number;
  long: number;
  label?: string;
  className?: string;
}

export function FieldMap({ lat, long, label, className = '' }: FieldMapProps) {
  return (
    <div
      className={[
        'rounded-[12px] overflow-hidden border border-[var(--line)]',
        className,
      ].join(' ')}
      style={{ height: 220 }}
    >
      <MapContainer
        center={[lat, long]}
        zoom={15}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom={false}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <Marker position={[lat, long]} icon={customIcon}>
          {label && <Popup>{label}</Popup>}
        </Marker>
      </MapContainer>
    </div>
  );
}
