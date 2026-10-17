import { attendanceAvailability, attendanceOccurrenceId, buildOccurrences, calculateStudentAttendance, dateInTimeZone, weekdayForDate, zonedDateTime } from './attendanceModel';

test('uses the configured institute time zone for date and scheduled-time comparisons', () => {
  expect(dateInTimeZone(new Date('2026-10-19T03:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-19');
  expect(weekdayForDate('2026-10-19')).toBe('Mon');
  expect(zonedDateTime('2026-10-19', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-10-19T03:30:00.000Z');
});

test('Take Attendance changes from upcoming to in progress at the scheduled start and remains open for late entry', () => {
  const occurrence = { date: '2026-10-19', startTime: '09:00', endTime: '11:00', timeZone: 'Asia/Kolkata' };
  expect(attendanceAvailability(occurrence, new Date('2026-10-19T03:29:59Z'))).toBe('UPCOMING');
  expect(attendanceAvailability(occurrence, new Date('2026-10-19T03:30:00Z'))).toBe('IN_PROGRESS');
  expect(attendanceAvailability(occurrence, new Date('2026-10-19T05:31:00Z'))).toBe('LATE_ENTRY');
  expect(attendanceAvailability({ ...occurrence, status: 'CANCELLED' }, new Date())).toBe('CANCELLED');
});

test('one published hybrid timetable lecture creates one date-specific occurrence', () => {
  const timetable = [{ id: 'lecture-a', day: 'Mon', status: 'PUBLISHED', batchDocId: 'batch-a', deliveryMode: 'HYBRID', roomId: 'room-1' }];
  const result = buildOccurrences(timetable, [], '2026-10-19', 'Asia/Kolkata');
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ occurrenceId: attendanceOccurrenceId('lecture-a', '2026-10-19'), deliveryMode: 'HYBRID', roomId: 'room-1' });
});

test('student percentages only use marked records from completed sessions and exclude excused', () => {
  const sessions = new Map([['a', { status: 'COMPLETED' }], ['b', { status: 'COMPLETED' }], ['c', { status: 'OPEN' }], ['d', { status: 'CANCELLED' }]]);
  const result = calculateStudentAttendance([
    { sessionId: 'a', status: 'PRESENT' }, { sessionId: 'b', status: 'EXCUSED' },
    { sessionId: 'c', status: 'ABSENT' }, { sessionId: 'd', status: 'ABSENT' },
  ], sessions);
  expect(result).toMatchObject({ finalizedMarkedSessions: 2, qualifyingSessions: 1, percentage: 100 });
  expect(calculateStudentAttendance([], sessions).percentage).toBeNull();
});
