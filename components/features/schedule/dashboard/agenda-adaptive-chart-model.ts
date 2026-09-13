const DAY_IN_MS = 24 * 60 * 60 * 1_000;

export type AgendaAdaptiveChartGranularity = "hourly" | "daily" | "monthly";

export type AgendaAdaptiveMetricValues = {
  total: number;
  open: number;
  overdue: number;
  completed: number;
  cancelled: number;
  no_show: number;
};

export type AgendaAdaptiveHourlyPoint = AgendaAdaptiveMetricValues & {
  hour: number;
};

export type AgendaAdaptiveDailyPoint = AgendaAdaptiveMetricValues & {
  date: string;
};

export type AgendaAdaptiveChartPoint = AgendaAdaptiveMetricValues & {
  key: string;
  hasSourceData: boolean;
};

type BuildAgendaAdaptiveChartSeriesInput = {
  hourly: readonly AgendaAdaptiveHourlyPoint[];
  daily: readonly AgendaAdaptiveDailyPoint[];
  dateFrom: string;
  dateTo: string;
};

export type AgendaAdaptiveChartModel = {
  granularity: AgendaAdaptiveChartGranularity;
  points: AgendaAdaptiveChartPoint[];
};

const EMPTY_METRICS: AgendaAdaptiveMetricValues = {
  total: 0,
  open: 0,
  overdue: 0,
  completed: 0,
  cancelled: 0,
  no_show: 0,
};

function parseCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return timestamp;
}

function formatCalendarDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function safeMetric(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeMetrics(
  point: AgendaAdaptiveMetricValues,
): AgendaAdaptiveMetricValues {
  return {
    total: safeMetric(point.total),
    open: safeMetric(point.open),
    overdue: safeMetric(point.overdue),
    completed: safeMetric(point.completed),
    cancelled: safeMetric(point.cancelled),
    no_show: safeMetric(point.no_show),
  };
}

function sumMetrics(
  current: AgendaAdaptiveMetricValues,
  next: AgendaAdaptiveMetricValues,
): AgendaAdaptiveMetricValues {
  const normalized = normalizeMetrics(next);

  return {
    total: current.total + normalized.total,
    open: current.open + normalized.open,
    overdue: current.overdue + normalized.overdue,
    completed: current.completed + normalized.completed,
    cancelled: current.cancelled + normalized.cancelled,
    no_show: current.no_show + normalized.no_show,
  };
}

export function getAgendaSelectedDayCount(dateFrom: string, dateTo: string) {
  const start = parseCalendarDate(dateFrom);
  const end = parseCalendarDate(dateTo);

  if (start === null || end === null || end < start) return 0;
  return Math.round((end - start) / DAY_IN_MS) + 1;
}

export function selectAgendaChartGranularity(
  dateFrom: string,
  dateTo: string,
): AgendaAdaptiveChartGranularity {
  const dayCount = getAgendaSelectedDayCount(dateFrom, dateTo);

  if (dayCount <= 1) return "hourly";
  if (dayCount <= 92) return "daily";
  return "monthly";
}

function buildHourlySeries(
  hourly: readonly AgendaAdaptiveHourlyPoint[],
): AgendaAdaptiveChartPoint[] {
  const metricsByHour = new Map<number, AgendaAdaptiveMetricValues>();

  hourly.forEach((point) => {
    if (!Number.isInteger(point.hour) || point.hour < 0 || point.hour > 23) {
      return;
    }

    metricsByHour.set(
      point.hour,
      sumMetrics(metricsByHour.get(point.hour) ?? EMPTY_METRICS, point),
    );
  });

  return Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour).padStart(2, "0"),
    ...(metricsByHour.get(hour) ?? EMPTY_METRICS),
    hasSourceData: metricsByHour.has(hour),
  }));
}

function indexDailyMetrics(
  daily: readonly AgendaAdaptiveDailyPoint[],
  rangeStart: number,
  rangeEnd: number,
) {
  const metricsByDate = new Map<string, AgendaAdaptiveMetricValues>();

  daily.forEach((point) => {
    const timestamp = parseCalendarDate(point.date);
    if (timestamp === null || timestamp < rangeStart || timestamp > rangeEnd) {
      return;
    }

    metricsByDate.set(
      point.date,
      sumMetrics(metricsByDate.get(point.date) ?? EMPTY_METRICS, point),
    );
  });

  return metricsByDate;
}

function buildDailySeries(
  daily: readonly AgendaAdaptiveDailyPoint[],
  rangeStart: number,
  rangeEnd: number,
) {
  const metricsByDate = indexDailyMetrics(daily, rangeStart, rangeEnd);
  const dayCount = Math.round((rangeEnd - rangeStart) / DAY_IN_MS) + 1;

  return Array.from({ length: dayCount }, (_, index) => {
    const date = formatCalendarDate(rangeStart + index * DAY_IN_MS);

    return {
      key: date,
      ...(metricsByDate.get(date) ?? EMPTY_METRICS),
      hasSourceData: metricsByDate.has(date),
    };
  });
}

function buildMonthlySeries(
  daily: readonly AgendaAdaptiveDailyPoint[],
  rangeStart: number,
  rangeEnd: number,
) {
  const metricsByDate = indexDailyMetrics(daily, rangeStart, rangeEnd);
  const metricsByMonth = new Map<string, AgendaAdaptiveMetricValues>();
  const sourceMonths = new Set<string>();

  metricsByDate.forEach((metrics, date) => {
    const month = date.slice(0, 7);
    metricsByMonth.set(
      month,
      sumMetrics(metricsByMonth.get(month) ?? EMPTY_METRICS, metrics),
    );
    sourceMonths.add(month);
  });

  const startDate = new Date(rangeStart);
  const endDate = new Date(rangeEnd);
  const months: AgendaAdaptiveChartPoint[] = [];
  let cursor = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1);
  const lastMonth = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    1,
  );

  while (cursor <= lastMonth) {
    const month = formatCalendarDate(cursor).slice(0, 7);
    months.push({
      key: month,
      ...(metricsByMonth.get(month) ?? EMPTY_METRICS),
      hasSourceData: sourceMonths.has(month),
    });
    const cursorDate = new Date(cursor);
    cursor = Date.UTC(
      cursorDate.getUTCFullYear(),
      cursorDate.getUTCMonth() + 1,
      1,
    );
  }

  return months;
}

/**
 * Keeps every selected hour/day in the dataset. X-axis label sampling belongs
 * to the chart renderer and never removes facts from this series.
 */
export function buildAgendaAdaptiveChartModel({
  hourly,
  daily,
  dateFrom,
  dateTo,
}: BuildAgendaAdaptiveChartSeriesInput): AgendaAdaptiveChartModel {
  const granularity = selectAgendaChartGranularity(dateFrom, dateTo);
  const rangeStart = parseCalendarDate(dateFrom);
  const rangeEnd = parseCalendarDate(dateTo);

  if (rangeStart === null || rangeEnd === null || rangeEnd < rangeStart) {
    return { granularity, points: [] };
  }

  if (granularity === "hourly") {
    return { granularity, points: buildHourlySeries(hourly) };
  }

  if (granularity === "daily") {
    return {
      granularity,
      points: buildDailySeries(daily, rangeStart, rangeEnd),
    };
  }

  return {
    granularity,
    points: buildMonthlySeries(daily, rangeStart, rangeEnd),
  };
}
