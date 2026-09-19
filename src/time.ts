export function calendarDateInTimeZone(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid timestamp: ${timestamp}`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!values.year || !values.month || !values.day) {
    throw new Error(`could not derive calendar date for ${timeZone}`);
  }
  return `${values.year}-${values.month}-${values.day}`;
}
