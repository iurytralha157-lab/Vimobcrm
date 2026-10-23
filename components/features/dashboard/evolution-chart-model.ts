/** Keep actual years and UTC offsets; split only the range separator. */
export function dashboardEvolutionTickLines(label: string, hourly = false) {
  if (hourly && /^\d{2}:00$/.test(label)) return [label.replace(":00", "h")];
  const separator = label.indexOf("–");
  return separator < 0 ? [label] : [label.slice(0, separator), `– ${label.slice(separator + 1)}`];
}

export function dashboardEvolutionTickWidth(label: string, hourly = false) {
  // At the fixed 10px tick font, 7px per character safely covers numeric dates,
  // translated month names and UTC offsets, including spacing between ticks.
  return Math.max(1, ...dashboardEvolutionTickLines(label, hourly).map((line) => line.length)) * 7;
}

export function dashboardEvolutionTickLayout(labels: readonly string[], width: number, mobile: boolean, hourly = false) {
  const plotWidth = Math.max(1, width - (mobile ? 38 : 85));
  const labelWidth = Math.max(24, ...labels.map((label) => dashboardEvolutionTickWidth(label, hourly)));
  const maximumTicks = Math.max(1, Math.floor(plotWidth / (labelWidth + 16)));
  const interval = Math.max(0, Math.ceil(labels.length / maximumTicks) - 1);
  const multiline = labels.some((label) => dashboardEvolutionTickLines(label, hourly).length > 1);
  return { interval, height: multiline ? 40 : 26, labelWidth };
}
