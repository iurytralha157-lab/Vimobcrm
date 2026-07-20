import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import 'leaflet/dist/leaflet.css';
import type { LatLngExpression, Map as LeafletMap } from 'leaflet';
import type { LocationData } from '@/hooks/use-lead-analytics';

interface VisitorMapProps {
  locations: LocationData[];
}

function escapePopupText(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function VisitorMap({ locations }: VisitorMapProps) {
  const { resolvedTheme } = useTheme();
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

      const tileStyle = resolvedTheme === 'dark' ? 'dark_all' : 'light_all';
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}{r}.png`, {
        maxZoom: 18,
      }).addTo(map);

      if (locations.length > 0) {
        const bounds = L.latLngBounds([]);

        locations.forEach((loc) => {
          const radius = Math.min(Math.max(loc.sessions * 3, 6), 30);
          const marker = L.circleMarker([loc.lat, loc.lng], {
            radius,
			fillColor: '#FF4529',
			color: '#D93620',
            weight: 1.5,
            opacity: 0.9,
            fillOpacity: 0.5,
          }).addTo(map);

          const city = escapePopupText(loc.city);
          const region = loc.region ? `, ${escapePopupText(loc.region)}` : '';
          const sessions = Number.isFinite(loc.sessions) ? loc.sessions : 0;

          marker.bindPopup(
            `<div style="font-size:13px;min-width:120px">
              <strong>${city}</strong>${region}
              <br/><span style="color:#666">${sessions} sessão${sessions > 1 ? 'es' : ''}</span>
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
  }, [locations, resolvedTheme]);

	return (
	  <div className="relative isolate z-0 h-full min-h-[300px] w-full overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
		<div ref={mapRef} className="h-full min-h-[300px] w-full" />
		{locations.length === 0 && (
		  <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-[7px] bg-[var(--app-surface-solid)]/95 px-3 py-2 text-xs text-[var(--app-text-secondary)] shadow-none backdrop-blur-sm">
			A localização aparecerá aqui conforme novos visitantes acessarem o site.
		  </div>
		)}
	  </div>
	);
}
