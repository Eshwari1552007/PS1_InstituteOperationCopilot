const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateAttendance, isDate, occurrenceId, weekdayInZone, zonedTimeToDate } = require('./attendance');

test('occurrence IDs are deterministic and dates must be calendar-valid', () => {
  assert.equal(occurrenceId('lecture-1', '2026-10-17'), 'lecture-1__2026-10-17');
  assert.equal(isDate('2026-10-17'), true);
  assert.equal(isDate('2026-02-31'), false);
});

test('attendance date and time use the configured institute zone', () => {
  assert.equal(weekdayInZone('2026-10-19', 'Asia/Kolkata'), 'Mon');
  assert.equal(zonedTimeToDate('2026-10-19', 9 * 60, 'Asia/Kolkata').toISOString(), '2026-10-19T03:30:00.000Z');
});

test('percent counts present and late, deduplicates sessions, and excludes excused or unfinalized data', () => {
  const result = calculateAttendance([
    { sessionId: 'one', status: 'PRESENT' }, { sessionId: 'one', status: 'ABSENT' },
    { sessionId: 'two', status: 'LATE' }, { sessionId: 'three', status: 'ABSENT' },
    { sessionId: 'four', status: 'EXCUSED' }, { sessionId: 'five', status: 'UNMARKED' },
  ]);
  assert.deepEqual(result.counts, { PRESENT: 1, ABSENT: 1, LATE: 1, EXCUSED: 1 });
  assert.equal(result.finalizedMarkedSessions, 4);
  assert.equal(result.qualifyingSessions, 3);
  assert.equal(result.percentage, 67);
  assert.equal(calculateAttendance([]).percentage, null);
});
