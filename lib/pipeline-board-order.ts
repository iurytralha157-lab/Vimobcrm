type OrderedLead = {
  board_order_at?: string | null;
  stage_entered_at?: string | null;
  created_at?: string | null;
};

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const MICROS_PER_MILLISECOND = BigInt(1000);
const MICROS_PER_SECOND = BigInt(1_000_000);
const SECONDS_PER_MINUTE = BigInt(60);
const SECONDS_PER_HOUR = BigInt(3600);
const SECONDS_PER_DAY = BigInt(86_400);

// Gregorian civil dates, independent of Date's millisecond precision and timezone.
function daysFromCivil(year: number, month: number, day: number) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear - 719468;
}

export function parsePipelineOrderMicros(value: string | null | undefined): bigint | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min, s, fraction = '', zone] = match;
  const [year, month, day, hour, minute, second] = [y, m, d, h, min, s].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
    || hour > 23 || minute > 59 || second > 59 || /[1-9]/.test(fraction.slice(6))) return null;
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (offsetHour > 23 || offsetMinute > 59) return null;
  const offset = (offsetHour * 60 + offsetMinute) * 60 * (zone[0] === '-' ? -1 : 1);
  const seconds = BigInt(daysFromCivil(year, month, day)) * SECONDS_PER_DAY
    + BigInt(hour * 3600 + minute * 60 + second - offset);
  return seconds * MICROS_PER_SECOND + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

export function formatPipelineOrderMicros(value: bigint): string | null {
  // Floor division also handles a fractional instant immediately before epoch.
  let seconds = value / MICROS_PER_SECOND;
  let fraction = value % MICROS_PER_SECOND;
  if (fraction < ZERO) { seconds -= ONE; fraction += MICROS_PER_SECOND; }
  let days = seconds / SECONDS_PER_DAY;
  let time = seconds % SECONDS_PER_DAY;
  if (time < ZERO) { days -= ONE; time += SECONDS_PER_DAY; }
  const shiftedDays = Number(days) + 719468;
  if (!Number.isSafeInteger(shiftedDays)) return null;
  const era = Math.floor(shiftedDays / 146097);
  const dayOfEra = shiftedDays - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  let year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  if (year < 1 || year > 9999) return null;
  const pad = (part: number | bigint, width = 2) => String(part).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(time / SECONDS_PER_HOUR)}:${pad(time / SECONDS_PER_MINUTE % SECONDS_PER_MINUTE)}:${pad(time % SECONDS_PER_MINUTE)}.${pad(fraction, 6)}Z`;
}

/** A strict timestamp interval; unrepresentable ties require a canonical refresh. */
export function getPipelineBoardOrderAtForIndex(leads: readonly OrderedLead[], targetIndex: number, nowMs: number): string | null {
  if (!Number.isSafeInteger(nowMs)) return null;
  const orderOf = (lead: OrderedLead) => parsePipelineOrderMicros(lead.board_order_at || lead.stage_entered_at || lead.created_at);
  const index = Math.min(Math.max(Math.trunc(targetIndex), 0), leads.length);
  const now = BigInt(nowMs) * MICROS_PER_MILLISECOND;
  if (index === 0) {
    let maximum = now - ONE;
    for (const lead of leads) {
      const order = orderOf(lead);
      if (order === null) return null;
      if (order > maximum) maximum = order;
    }
    return formatPipelineOrderMicros(maximum + ONE);
  }
  const above = orderOf(leads[index - 1]);
  if (above === null) return null;
  if (index === leads.length) return formatPipelineOrderMicros(above - TWO * MICROS_PER_SECOND);
  const below = orderOf(leads[index]);
  if (below === null || above - below <= ONE) return null;
  return formatPipelineOrderMicros(below + (above - below) / TWO);
}
