import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { LatLngExpression, Map as LeafletMap } from 'leaflet';
import type { LocationData } from '@/hooks/use-lead-analytics';

interface VisitorMapProps {
  locations: LocationData[];
}

export function VisitorMap({ locations }: VisitorMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    let disposed = false;

    mapInstance.current?.remove();
    mapInstance.current = null;

    void import('leaflet').then(({ default: L }) => {
      if (!mapRef.current || disposed) return;

      const map = L.map(mapRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
        attributionControl: false,
      });

      const defaultCenter: LatLngExpression = [-14.235, -51.925];
      const defaultZoom = 4;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(map);

      if (locations.length > 0) {
        const bounds = L.latLngBounds([]);

        locations.forEach((loc) => {
          const radius = Math.min(Math.max(loc.sessions * 3, 6), 30);
          const marker = L.circleMarker([loc.lat, loc.lng], {
            radius,
            fillColor: 'hsl(221, 83%, 53%)',
            color: 'hsl(221, 83%, 43%)',
            weight: 1.5,
            opacity: 0.9,
            fillOpacity: 0.5,
          }).addTo(map);

          marker.bindPopup(
            `<div style="font-size:13px;min-width:120px">
              <strong>${loc.city}</strong>${loc.region ? `, ${loc.region}` : ''}
              <br/><span style="color:#666">${loc.sessions} sessão${loc.sessions > 1 ? 'es' : ''}</span>
            </div>`
          );

          bounds.extend([loc.lat, loc.lng]);
        });

        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
      } else {
        map.setView(defaultCenter, defaultZoom);
      }

      mapInstance.current = map;
    });

    return () => {
      disposed = true;
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, [locations]);

  return (
    <div
      ref={mapRef}
      className="w-full h-full rounded-lg"
      style={{ minHeight: '300px' }}
    />
  );
}
