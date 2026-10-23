// Local to DateFilterPopover; standalone calendars keep their existing theme.
export const DATE_FILTER_STYLE = `
@layer utilities {
[data-date-filter] {
  --date-filter-orange-half: color-mix(in srgb, var(--primary) 50%, transparent);
}
[data-date-filter] [data-date-calendar] [data-day][data-selected],
[data-date-filter] [data-date-calendar] [data-day][data-today] {
  opacity: 1 !important;
}
[data-date-filter] [data-date-calendar] [data-day][data-today]:not([data-selected]) > button,
[data-date-filter] [data-date-calendar] [data-day]:not([data-selected]) > button:not(:disabled):hover,
[data-date-filter] [data-date-shortcut]:hover {
  background: var(--date-filter-orange-half) !important;
  color: #fff !important;
}
[data-date-filter] [data-date-calendar] [data-day][data-selected] > button,
[data-date-filter] [data-date-shortcut][aria-pressed="true"] {
  background: var(--primary) !important;
  color: #fff !important;
}
/* Calendar's range_middle alone supplies !rounded-none, never an endpoint. */
[data-date-filter] [data-date-calendar] [data-day][data-selected][class~="!rounded-none"] {
  background: transparent !important;
}
[data-date-filter] [data-date-calendar] [data-day][data-selected][class~="!rounded-none"] > button {
  background: var(--date-filter-orange-half) !important;
}
[data-date-filter] [data-date-action] {
  font-size: 12px !important;
  font-weight: 300 !important;
  letter-spacing: 0 !important;
  text-transform: none;
}
[data-date-filter] [data-date-action="apply"] {
  background: var(--date-filter-orange-half) !important;
  color: #fff !important;
}
[data-date-filter] [data-date-action="apply"]:enabled:hover {
  background: var(--primary) !important;
}
}
`;
