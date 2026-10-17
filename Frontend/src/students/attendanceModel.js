export const ATTENDANCE_STATES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];
export const DEFAULT_INSTITUTE_TIME_ZONE = 'Asia/Kolkata';

export function dateInTimeZone(date, timeZone = DEFAULT_INSTITUTE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function weekdayForDate(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));
}

export function zonedDateTime(date, time, timeZone = DEFAULT_INSTITUTE_TIME_ZONE) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = wanted;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp));
    const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    const represented = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
    const adjusted = timestamp + wanted - represented;
    if (adjusted === timestamp) break;
    timestamp = adjusted;
  }
  return new Date(timestamp);
}

export function attendanceOccurrenceId(timetableSessionId, date) { return `${timetableSessionId}__${date}`; }

export function attendanceAvailability(session, now = new Date()) {
  if (session?.status === 'CANCELLED') return 'CANCELLED';
  if (session?.status === 'COMPLETED') return 'RECORDED';
  const startTime = session?.startTime || minuteTime(session?.startMinutes);
  const endTime = session?.endTime || minuteTime(session?.endMinutes);
  const start = session?.startAt?.toDate?.() || zonedDateTime(session.date, startTime, session.timeZone);
  const end = session?.endAt?.toDate?.() || zonedDateTime(session.date, endTime, session.timeZone);
  if (now < start) return 'UPCOMING';
  if (now < end) return 'IN_PROGRESS';
  return 'LATE_ENTRY';
}

function minuteTime(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '00:00';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function calculateStudentAttendance(records, sessionById = new Map()) {
  const unique = new Map();
  records.forEach((record) => {
    const session = sessionById.get(record.sessionId);
    if (!session || session.status !== 'COMPLETED' || session.status === 'CANCELLED' || !ATTENDANCE_STATES.includes(record.status)) return;
    unique.set(record.sessionId, record);
  });
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  unique.forEach((record) => { counts[record.status] += 1; });
  // Default policy: Late counts as attended; Excused is omitted from the denominator.
  const denominator = counts.PRESENT + counts.ABSENT + counts.LATE;
  return { counts, finalizedMarkedSessions: unique.size, qualifyingSessions: denominator, percentage: denominator ? Math.round((counts.PRESENT + counts.LATE) / denominator * 100) : null };
}

export function buildOccurrences(timetableSessions, attendanceSessions, date, timeZone = DEFAULT_INSTITUTE_TIME_ZONE) {
  const day = weekdayForDate(date);
  const saved = new Map(attendanceSessions.filter((item) => item.date === date).map((item) => [item.scheduledSessionId, item]));
  return timetableSessions.filter((item) => item.status === 'PUBLISHED' && item.day === day).map((item) => ({
    ...item,
    date,
    timeZone,
    occurrenceId: attendanceOccurrenceId(item.id, date),
    attendanceSession: saved.get(item.id) || null,
  })).sort((a, b) => Number(a.startMinutes) - Number(b.startMinutes));
}
