import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import 'leaflet/dist/leaflet.css';
import type { LatLngExpression, Map as LeafletMap } from 'leaflet';
import type { LocationData } from '@/hooks/use-lead-analytics';

interface VisitorMapProps {
  locations: LocationData[];
}

const COUNTRY_CENTERS: Record<string, [number, number]> = {
  BR: [-14.235, -51.925],
  AR: [-38.4161, -63.6167],
  BO: [-16.2902, -63.5887],
  CL: [-35.6751, -71.543],
  PY: [-23.4425, -58.4438],
  PE: [-9.19, -75.0152],
  PT: [39.3999, -8.2245],
  US: [37.0902, -95.7129],
  UY: [-32.5228, -55.7658],
};

function resolveLocationCoordinates(location: LocationData): [number, number] | null {
  if (Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
    return [Number(location.lat), Number(location.lng)];
  }
  return COUNTRY_CENTERS[(location.country || '').toUpperCase()] || null;
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
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    if (!mapRef.current) return;
    let disposed = false;
    setMapError(false);

    mapInstance.current?.remove();
    mapInstance.current = null;

    void import('leaflet').then(({ default: L }) => {
      if (!mapRef.current || disposed) return;

      const map = L.map(mapRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: false,
      });
      mapInstance.current = map;

      const defaultCenter: LatLngExpression = [-14.235, -51.925];
      const defaultZoom = 4;

      const tileStyle = resolvedTheme === 'dark' ? 'dark_all' : 'light_all';
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}{r}.png`, {
        maxZoom: 18,
      }).addTo(map);

      const mappedLocations = locations
        .map((location) => ({ location, coordinates: resolveLocationCoordinates(location) }))
        .filter((item): item is { location: LocationData; coordinates: [number, number] } => item.coordinates !== null);

      if (mappedLocations.length > 0) {
        const bounds = L.latLngBounds([]);

        mappedLocations.forEach(({ location: loc, coordinates }) => {
          const radius = Math.min(Math.max(loc.sessions * 3, 6), 30);
          const marker = L.circleMarker(coordinates, {
            radius,
			fillColor: 'var(--primary)',
			color: 'var(--primary)',
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
              <br/><span style="color:var(--app-text-tertiary)">${sessions} sessão${sessions > 1 ? 'es' : ''}</span>
            </div>`
          );

          bounds.extend(coordinates);
        });

        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
      } else {
        map.setView(defaultCenter, defaultZoom);
      }

    }).catch(() => {
      if (disposed) return;
      mapInstance.current?.remove();
      mapInstance.current = null;
      setMapError(true);
    });

    return () => {
      disposed = true;
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, [locations, resolvedTheme]);

  return (
    <div className="relative isolate z-0 h-full min-h-[300px] w-full overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
      <div
        ref={mapRef}
        className="h-full min-h-[300px] w-full"
        aria-label="Mapa interativo com a localização aproximada dos visitantes"
      />
      {mapError ? (
        <div className="absolute inset-3 flex items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)]/95 px-4 text-center text-xs font-light leading-5 text-[var(--app-text-secondary)]">
          Não foi possível carregar o mapa. A lista de localizações continua disponível abaixo.
        </div>
      ) : locations.length === 0 ? (
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-[6px] bg-[var(--app-surface-solid)]/95 px-3 py-2 text-xs font-light text-[var(--app-text-secondary)] shadow-none">
          A localização aparecerá aqui conforme novos visitantes acessarem o site.
        </div>
      ) : null}
    </div>
  );
}
