export function relativeDateClockKey(now: Date) {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}:${now.getTimezoneOffset()}`;
}

export function millisecondsUntilNextCivilDay(now: Date) {
  const next = new Date(now);
  next.setHours(24, 0, 0, 50);
  return Math.max(50, next.getTime() - now.getTime());
}
