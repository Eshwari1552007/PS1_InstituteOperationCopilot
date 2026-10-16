import { durationMinutes, generateSchedule, overlaps, sessionConflicts } from './scheduler';

const settings = {
  workingDays: ['Mon', 'Tue'], openTime: '09:00', closeTime: '12:00', slotIncrement: 30,
  breaks: [{ id: 'lunch', name: 'Lunch', enabled: true, startTime: '10:30', endTime: '11:00' }],
  rooms: [{ id: 'r1', name: 'Room 1', type: 'Classroom', capacity: 25 }],
};
const batch = (overrides = {}) => ({ documentId: 'batch-a', batchId: 'BAT-A', name: 'Batch A', courseName: 'Math', teacherId: 'trainer-a', teacherName: 'Teacher A', capacity: 20, durationHours: 1.5, sessionsPerWeek: 1, daysOfWeek: ['MON'], learningModes: ['OFFLINE'], ...overrides });

test('derives valid session duration and rejects malformed legacy clock values', () => {
  expect(durationMinutes(batch())).toBe(90);
  expect(durationMinutes(batch({ durationHours: undefined, startTime: '09:00', endTime: '10:30' }))).toBe(90);
  expect(durationMinutes(batch({ durationHours: undefined, startTime: '23:00', endTime: '23:09' }))).toBeNull();
  expect(durationMinutes(batch({ durationHours: undefined }))).toBeNull();
});

test('detects partial interval overlap', () => {
  expect(overlaps(600, 660, 630, 690)).toBe(true);
  expect(overlaps(540, 600, 600, 660)).toBe(false);
});

test('schedules with real session duration and avoids configured breaks', () => {
  const result = generateSchedule(settings, [batch()]);
  expect(result.unscheduled).toHaveLength(0);
  expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0]).toMatchObject({ startMinutes: 540, endMinutes: 630, durationMinutes: 90, day: 'Mon', roomId: 'r1' });
});

test('reports a capacity or time reason instead of forcing an invalid class', () => {
  const result = generateSchedule({ ...settings, closeTime: '10:00', breaks: [] }, [batch({ durationHours: 2 })]);
  expect(result.sessions).toHaveLength(0);
  expect(result.unscheduled[0].reason).toMatch(/could fit|duration/i);
});

test('manual editor validation catches partially overlapping same-teacher/room assignments', () => {
  const first = { id: 'one', batchDocId: 'batch-a', teacherId: 'trainer-a', roomId: 'r1', day: 'Mon', startMinutes: 540, endMinutes: 630 };
  const secondBatch = batch({ documentId: 'batch-b', teacherId: 'trainer-a', durationHours: 1 });
  const draft = { batchDocId: 'batch-b', teacherId: 'trainer-a', roomId: 'r1', day: 'Mon', startMinutes: 600, endMinutes: 660 };
  expect(sessionConflicts(draft, [first], [batch(), secondBatch], settings)).toEqual(expect.arrayContaining([
    'Room Room 1 is booked during this time.',
    'This teacher has another class during this time.',
  ]));
});

test('generation preserves published and manual assignments', () => {
  const protectedSession = { id: 'manual-1', batchDocId: 'batch-a', teacherId: 'trainer-a', roomId: 'r1', roomName: 'Room 1', day: 'Tue', startMinutes: 540, endMinutes: 630, durationMinutes: 90, source: 'MANUAL', status: 'DRAFT' };
  const result = generateSchedule(settings, [batch()], [protectedSession]);
  expect(result.sessions).toContainEqual(protectedSession);
  expect(result.sessions).toHaveLength(1);
});
