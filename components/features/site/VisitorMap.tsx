import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import "leaflet/dist/leaflet.css";
import type { LatLngExpression, Map as LeafletMap } from "leaflet";
import type { LocationData } from "@/hooks/use-lead-analytics";
import {
  getCountryMetadata,
  getLocationLabel,
} from "@/components/features/site/analytics/location-format";

interface VisitorMapProps {
  locations: LocationData[];
}

type CoordinateSource = "reported" | "country-center";

interface MapPoint {
  coordinates: [number, number];
  label: string;
  source: CoordinateSource;
}

interface ResolvedLocation {
  location: LocationData;
  point: MapPoint | null;
  reportedLabel: string;
}

interface VisitorMapMarker {
  locations: ResolvedLocation[];
  point: MapPoint;
  sessions: number;
}

function resolveMapPoint(location: LocationData): MapPoint | null {
  if (
    typeof location.lat === "number" &&
    Number.isFinite(location.lat) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    typeof location.lng === "number" &&
    Number.isFinite(location.lng) &&
    location.lng >= -180 &&
    location.lng <= 180
  ) {
    return {
      coordinates: [location.lat, location.lng],
      label: getLocationLabel(location, "Localização não informada"),
      source: "reported",
    };
  }

  const country = getCountryMetadata(location.country);
  if (!country) return null;

  return {
    coordinates: country.center,
    label: `Centro aproximado de ${country.label}`,
    source: "country-center",
  };
}

function getSessionCount(location: LocationData) {
  return Number.isFinite(location.sessions)
    ? Math.max(0, location.sessions)
    : 0;
}

function formatSessionCount(count: number) {
  return `${count} ${count === 1 ? "sessão" : "sessões"}`;
}

function getMarkerRadius(sessions: number, maxSessions: number) {
  if (maxSessions <= 0) return 7;
  return 7 + Math.sqrt(sessions / maxSessions) * 15;
}

function summarizeReportedLocations(locations: ResolvedLocation[]) {
  const summaries = new Map<string, number>();
  locations.forEach(({ location, reportedLabel }) => {
    summaries.set(
      reportedLabel,
      (summaries.get(reportedLabel) ?? 0) + getSessionCount(location),
    );
  });

  return Array.from(summaries, ([label, sessions]) => ({ label, sessions }));
}

export function VisitorMap({ locations }: VisitorMapProps) {
  const { resolvedTheme } = useTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<LeafletMap | null>(null);
  const [mapError, setMapError] = useState(false);

  const resolvedLocations = useMemo<ResolvedLocation[]>(
    () =>
      locations.map((location) => ({
        location,
        point: resolveMapPoint(location),
        reportedLabel: getLocationLabel(location, "Localização não informada"),
      })),
    [locations],
  );

  const mapMarkers = useMemo<VisitorMapMarker[]>(() => {
    const markers: VisitorMapMarker[] = [];
    const groupedMarkers = new Map<string, VisitorMapMarker>();

    resolvedLocations.forEach((resolvedLocation) => {
      const { point } = resolvedLocation;
      if (!point) return;

      const sessions = getSessionCount(resolvedLocation.location);
      const coordinateKey = `${point.source}:${point.coordinates.join(":")}`;
      const existingMarker = groupedMarkers.get(coordinateKey);
      if (existingMarker) {
        existingMarker.locations.push(resolvedLocation);
        existingMarker.sessions += sessions;
        return;
      }

      const marker = {
        locations: [resolvedLocation],
        point,
        sessions,
      };
      groupedMarkers.set(coordinateKey, marker);
      markers.push(marker);
    });

    return markers;
  }, [resolvedLocations]);
  const unmappedLocations = useMemo(
    () => resolvedLocations.filter(({ point }) => point === null),
    [resolvedLocations],
  );
  const reportedCoordinateCount = mapMarkers.filter(
    ({ point }) => point.source === "reported",
  ).length;
  const countryCenterCount = mapMarkers.length - reportedCoordinateCount;
  const mappedLocationCount =
    resolvedLocations.length - unmappedLocations.length;
  const unmappedCount = unmappedLocations.length;

  useEffect(() => {
    if (!mapRef.current) return;
    let disposed = false;
    setMapError(false);

    mapInstance.current?.remove();
    mapInstance.current = null;

    void import("leaflet")
      .then(({ default: L }) => {
        if (!mapRef.current || disposed) return;

        const map = L.map(mapRef.current, {
          zoomControl: true,
          scrollWheelZoom: false,
          attributionControl: true,
        });
        map.attributionControl.setPrefix(false);
        mapInstance.current = map;

        const defaultCenter: LatLngExpression = [-14.235, -51.925];
        const defaultZoom = 4;

        const tileStyle = resolvedTheme === "dark" ? "dark_all" : "light_all";
        L.tileLayer(
          `https://{s}.basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}{r}.png`,
          {
            maxZoom: 18,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          },
        ).addTo(map);

        if (mapMarkers.length > 0) {
          const bounds = L.latLngBounds([]);
          const maxSessions = Math.max(
            ...mapMarkers.map(({ sessions }) => sessions),
          );

          mapMarkers.forEach(
            ({ locations: markerLocations, point, sessions }) => {
              const usesCountryCenter = point.source === "country-center";
              const reportedLocations =
                summarizeReportedLocations(markerLocations);
              const sourceDescription = usesCountryCenter
                ? `Posição aproximada no centro do país; ${reportedLocations.length} ${
                    reportedLocations.length === 1
                      ? "localidade sem coordenada está agrupada"
                      : "localidades sem coordenadas estão agrupadas"
                  } neste ponto.`
                : reportedLocations.length > 1
                  ? `Coordenada recebida da visita; ${reportedLocations.length} localidades estão agrupadas neste ponto.`
                  : "Coordenada recebida da visita; a localização ainda pode ser aproximada.";
              const accessibleLabel = `${point.label}. ${formatSessionCount(sessions)}. ${sourceDescription}`;

              const marker = L.circleMarker(point.coordinates, {
                radius: getMarkerRadius(sessions, maxSessions),
                fillColor: "var(--primary)",
                color: "var(--primary)",
                dashArray: usesCountryCenter ? "4 4" : undefined,
                weight: usesCountryCenter ? 2 : 1.5,
                opacity: usesCountryCenter ? 0.85 : 0.95,
                fillOpacity: usesCountryCenter ? 0.18 : 0.55,
              }).addTo(map);

              const popup = document.createElement("div");
              popup.style.minWidth = "168px";
              popup.style.fontSize = "13px";
              popup.setAttribute("role", "group");
              popup.setAttribute("aria-label", accessibleLabel);

              const title = document.createElement("strong");
              title.textContent = point.label;
              popup.appendChild(title);

              const sessionText = document.createElement("p");
              sessionText.style.margin = "4px 0 0";
              sessionText.textContent = formatSessionCount(sessions);
              popup.appendChild(sessionText);

              const precisionText = document.createElement("p");
              precisionText.style.margin = "4px 0 0";
              precisionText.style.fontSize = "11px";
              precisionText.style.opacity = "0.72";
              precisionText.textContent = sourceDescription;
              popup.appendChild(precisionText);

              if (usesCountryCenter || reportedLocations.length > 1) {
                const reportedLocationsLabel = document.createElement("p");
                reportedLocationsLabel.style.margin = "8px 0 2px";
                reportedLocationsLabel.style.fontSize = "11px";
                reportedLocationsLabel.style.fontWeight = "600";
                reportedLocationsLabel.textContent =
                  reportedLocations.length === 1
                    ? "Localidade informada"
                    : "Localidades informadas";
                popup.appendChild(reportedLocationsLabel);

                const reportedLocationsList = document.createElement("ul");
                reportedLocationsList.style.margin = "0";
                reportedLocationsList.style.maxHeight = "144px";
                reportedLocationsList.style.overflowY = "auto";
                reportedLocationsList.style.paddingLeft = "16px";
                reportedLocations.forEach(
                  ({ label, sessions: locationSessions }) => {
                    const item = document.createElement("li");
                    item.textContent = `${label}: ${formatSessionCount(locationSessions)}`;
                    reportedLocationsList.appendChild(item);
                  },
                );
                popup.appendChild(reportedLocationsList);
              }

              marker.bindPopup(popup);
              marker.bindTooltip(point.label, {
                direction: "top",
                opacity: 0.9,
              });

              const markerElement = marker.getElement();
              if (markerElement) {
                markerElement.setAttribute("aria-label", accessibleLabel);
                markerElement.setAttribute("role", "button");
                markerElement.setAttribute("tabindex", "0");
                markerElement.addEventListener("keydown", (event) => {
                  const keyboardEvent = event as KeyboardEvent;
                  if (
                    keyboardEvent.key !== "Enter" &&
                    keyboardEvent.key !== " "
                  ) {
                    return;
                  }
                  keyboardEvent.preventDefault();
                  marker.openPopup();
                });
              }

              bounds.extend(point.coordinates);
            },
          );

          map.fitBounds(bounds, { padding: [34, 34], maxZoom: 10 });
        } else {
          map.setView(defaultCenter, defaultZoom);
        }
      })
      .catch(() => {
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
  }, [mapMarkers, resolvedTheme]);

  return (
    <section
      className="relative isolate z-0 h-full min-h-[300px] w-full overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]"
      aria-label="Distribuição geográfica dos visitantes"
    >
      <div
        ref={mapRef}
        className="h-full min-h-[300px] w-full"
        aria-label={`Mapa interativo com ${mapMarkers.length} ${
          mapMarkers.length === 1 ? "ponto" : "pontos"
        } representando ${mappedLocationCount} ${
          mappedLocationCount === 1 ? "localização" : "localizações"
        } de visitantes`}
      />

      {!mapError && mapMarkers.length > 0 && (
        <div
          className="pointer-events-none absolute right-3 top-3 z-[500] max-w-[190px] rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface-solid)]/95 px-2.5 py-2 text-[10px] leading-4 text-[var(--app-text-secondary)] shadow-sm"
          aria-label="Legenda do mapa"
        >
          <p className="font-medium text-[var(--app-text-primary)]">Legenda</p>
          {reportedCoordinateCount > 0 && (
            <p className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary/60 ring-1 ring-primary"
                aria-hidden="true"
              />
              Coordenada recebida
            </p>
          )}
          {countryCenterCount > 0 && (
            <p className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-primary bg-primary/15"
                aria-hidden="true"
              />
              Centro do país (aprox.)
            </p>
          )}
          <p className="mt-0.5">Círculo maior = mais sessões</p>
        </div>
      )}

      {mapError ? (
        <div
          className="absolute inset-3 z-[500] flex items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)]/95 px-4 text-center text-xs font-light leading-5 text-[var(--app-text-secondary)]"
          role="status"
        >
          Não foi possível carregar o mapa. A lista de localizações continua
          disponível abaixo.
        </div>
      ) : locations.length === 0 ? (
        <div className="pointer-events-none absolute bottom-7 left-3 right-3 z-[500] rounded-[6px] bg-[var(--app-surface-solid)]/95 px-3 py-2 text-xs font-light text-[var(--app-text-secondary)] shadow-sm">
          A localização aparecerá aqui conforme novos visitantes acessarem o
          site.
        </div>
      ) : mapMarkers.length === 0 ? (
        <div
          className="pointer-events-none absolute bottom-7 left-3 right-3 z-[500] rounded-[6px] bg-[var(--app-surface-solid)]/95 px-3 py-2 text-xs font-light leading-5 text-[var(--app-text-secondary)] shadow-sm"
          role="status"
        >
          As visitas não têm coordenadas suficientes para aparecer no mapa. Elas
          continuam disponíveis na lista.
        </div>
      ) : unmappedCount > 0 ? (
        <div className="pointer-events-none absolute bottom-7 left-3 z-[500] max-w-[220px] rounded-[6px] bg-[var(--app-surface-solid)]/95 px-2.5 py-1.5 text-[10px] leading-4 text-[var(--app-text-secondary)] shadow-sm">
          {unmappedCount}{" "}
          {unmappedCount === 1
            ? "localização aparece"
            : "localizações aparecem"}{" "}
          somente na lista por não ter coordenadas.
        </div>
      ) : null}

      <h3 className="sr-only">Resumo das localizações de visitantes</h3>
      {resolvedLocations.length > 0 ? (
        <ul className="sr-only">
          {mapMarkers.map(
            ({ locations: markerLocations, point, sessions }, markerIndex) => {
              const reportedLocations =
                summarizeReportedLocations(markerLocations);
              const markerKey = `${point.source}-${point.coordinates.join("-")}-${markerIndex}`;

              if (
                point.source === "country-center" ||
                reportedLocations.length > 1
              ) {
                return (
                  <li key={markerKey}>
                    {point.label}: {formatSessionCount(sessions)}.{" "}
                    {point.source === "country-center"
                      ? "Ponto aproximado"
                      : "Coordenada recebida"}{" "}
                    que agrupa {reportedLocations.length}{" "}
                    {reportedLocations.length === 1
                      ? "localidade informada"
                      : "localidades informadas"}
                    .
                    <ul>
                      {reportedLocations.map(
                        ({ label, sessions: locationSessions }, index) => (
                          <li key={`${label}-${index}`}>
                            {label}: {formatSessionCount(locationSessions)}.
                          </li>
                        ),
                      )}
                    </ul>
                  </li>
                );
              }

              const reportedLocation = reportedLocations[0];
              return (
                <li key={markerKey}>
                  {reportedLocation?.label ?? point.label}:{" "}
                  {formatSessionCount(sessions)}. Coordenada recebida; exibida
                  no mapa.
                </li>
              );
            },
          )}
          {unmappedLocations.map(({ location, reportedLabel }, index) => (
            <li key={`unmapped-${reportedLabel}-${index}`}>
              {reportedLabel}: {formatSessionCount(getSessionCount(location))}.
              Sem coordenada disponível; não exibida no mapa.
            </li>
          ))}
        </ul>
      ) : (
        <p className="sr-only">Ainda não há localizações de visitantes.</p>
      )}
    </section>
  );
}
