const ATTENDANCE_STATUSES = new Set(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function weekdayInZone(date, timeZone) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));
  return ({ Mon: 'Mon', Tue: 'Tue', Wed: 'Wed', Thu: 'Thu', Fri: 'Fri', Sat: 'Sat', Sun: 'Sun' })[short];
}

function zonedTimeToDate(date, minutes, timeZone = 'Asia/Kolkata') {
  if (!isDate(date) || !Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) throw new Error('Invalid scheduled date or time.');
  const [year, month, day] = date.split('-').map(Number);
  const naiveUtc = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let utc = naiveUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utc));
    const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const representedUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
    const adjusted = utc + (naiveUtc - representedUtc);
    if (adjusted === utc) break;
    utc = adjusted;
  }
  return new Date(utc);
}

function occurrenceId(timetableSessionId, date) { return `${timetableSessionId}__${date}`; }

function calculateAttendance(records) {
  const unique = new Map();
  records.filter((record) => ATTENDANCE_STATUSES.has(record.status)).forEach((record) => { if (!unique.has(record.sessionId)) unique.set(record.sessionId, record); });
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  unique.forEach((record) => { counts[record.status] += 1; });
  const denominator = counts.PRESENT + counts.ABSENT + counts.LATE;
  return { counts, finalizedMarkedSessions: unique.size, qualifyingSessions: denominator, percentage: denominator ? Math.round(((counts.PRESENT + counts.LATE) / denominator) * 100) : null };
}

module.exports = { ATTENDANCE_STATUSES, calculateAttendance, isDate, occurrenceId, weekdayInZone, zonedTimeToDate };
