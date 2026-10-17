import { render, screen, fireEvent } from '@testing-library/react';
import { activeRooms, computeRoomUtilization, durationMinutes, filterEligibleBatches, generateSchedule, overlaps, roomPoolFor, sessionConflicts, weeklyHours, validateSchedule } from './scheduler';
import WeeklyTimetable from './WeeklyTimetable';

const settings = {
  workingDays: ['Mon', 'Tue', 'Wed'], openTime: '09:00', closeTime: '18:00', slotIncrement: 30,
  breaks: [{ id: 'lunch', name: 'Lunch', enabled: true, startTime: '13:00', endTime: '14:00' }],
  rooms: [{ id: 'r1', name: 'Room 1', type: 'Classroom', capacity: 25 }],
};
const batch = (overrides = {}) => ({ documentId: 'batch-a', batchId: 'BAT-A', name: 'Batch A', courseName: 'Math', teacherId: 'trainer-a', teacherName: 'Teacher A', capacity: 20, weeklyTeachingHours: 2, unavailableDays: [], daysOfWeek: [], learningModes: ['OFFLINE'], ...overrides });

test('derives valid session duration and rejects malformed legacy clock values', () => {
  expect(weeklyHours(batch())).toBe(2);
  expect(durationMinutes(batch())).toBe(120);
  expect(durationMinutes(batch({ weeklyTeachingHours: undefined, durationHours: undefined, startTime: '09:00', endTime: '10:30' }))).toBe(90);
  expect(durationMinutes(batch({ weeklyTeachingHours: undefined, durationHours: undefined, startTime: '23:00', endTime: '23:09' }))).toBeNull();
  expect(durationMinutes(batch({ weeklyTeachingHours: undefined, durationHours: undefined }))).toBeNull();
});

test('detects partial interval overlap', () => {
  expect(overlaps(600, 660, 630, 690)).toBe(true);
  expect(overlaps(540, 600, 600, 660)).toBe(false);
});

test('schedules with real session duration and avoids configured breaks', () => {
  const result = generateSchedule(settings, [batch()]);
  expect(result.unscheduled).toHaveLength(0);
  expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0]).toMatchObject({ startMinutes: 540, endMinutes: 660, durationMinutes: 120, day: 'Mon', roomId: 'r1' });
});

test('splits whole weekly teaching hours using institute working days, ignoring legacy batch days off', () => {
  const result = generateSchedule(settings, [batch({ weeklyTeachingHours: 5, unavailableDays: ['MON'] })]);
  expect(result.unscheduled).toHaveLength(0);
  expect(result.sessions.map((session) => session.durationMinutes)).toEqual([120, 120, 60]);
  expect(result.sessions.some((session) => session.day === 'Mon')).toBe(true);
  expect(result.sessions.reduce((sum, session) => sum + session.durationMinutes, 0)).toBe(300);
});

test('reports a capacity or time reason instead of forcing an invalid class', () => {
  const result = generateSchedule({ ...settings, workingDays: ['Mon'], closeTime: '10:00', breaks: [] }, [batch({ weeklyTeachingHours: 2 })]);
  expect(result.sessions.map((session) => session.durationMinutes)).toEqual([60]);
  expect(result.unscheduled).toHaveLength(1);
  expect(result.unscheduled[0].scheduledHours).toBe(1);
  expect(result.unscheduled[0].reason).toMatch(/only|fit|duration/i);
});

test('falls back to online when a dual-mode batch has no physical room that fits', () => {
  const result = generateSchedule({ ...settings, rooms: [{ id: 'tiny', name: 'Tiny room', type: 'Classroom', capacity: 5 }] }, [batch({ capacity: 20, learningModes: ['OFFLINE', 'ONLINE'] })]);
  expect(result.report[0].status).toBe('COMPLETE');
  expect(result.sessions[0].roomId).toBe('ONLINE');
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
  const protectedSession = { id: 'manual-1', batchDocId: 'batch-a', teacherId: 'trainer-a', roomId: 'r1', roomName: 'Room 1', day: 'Tue', startMinutes: 540, endMinutes: 660, durationMinutes: 120, sessionIndex: 1, source: 'MANUAL', status: 'DRAFT' };
  const result = generateSchedule(settings, [batch()], [protectedSession]);
  expect(result.sessions).toContainEqual(protectedSession);
  expect(result.sessions).toHaveLength(1);
});

test('reports all same-course batches, validates hours, spreads sessions, and regenerates without duplicates', () => {
  const many = Array.from({ length: 8 }, (_, index) => batch({ documentId: `batch-${index}`, courseDocId: 'course-shared', courseName: 'Math', teacherId: `trainer-${index}`, weeklyTeachingHours: 2 }));
  const first = generateSchedule(settings, many);
  expect(first.eligibleCount).toBe(8);
  expect(first.courseCount).toBe(1);
  expect(first.report).toHaveLength(8);
  expect(first.report.every((item) => item.status === 'COMPLETE' && item.scheduledHours === item.requiredHours)).toBe(true);
  expect(first.sessions.every((item) => item.durationMinutes === 120 || item.durationMinutes === 60)).toBe(true);
  const regenerated = generateSchedule(settings, many, first.sessions);
  expect(regenerated.sessions).toHaveLength(first.sessions.length);
  expect(new Set(regenerated.sessions.map((item) => item.id)).size).toBe(regenerated.sessions.length);
});

test('reports missing trainer/course configuration instead of silently skipping eligible batches', () => {
  const result = generateSchedule(settings, [batch({ documentId: 'no-trainer', teacherId: '' }), batch({ documentId: 'no-course', courseStatus: 'MISSING' })]);
  expect(result.eligibleCount).toBe(2);
  expect(result.report).toHaveLength(2);
  expect(result.unscheduled.map((item) => item.reason).join(' ')).toMatch(/trainer/);
  expect(result.unscheduled.map((item) => item.reason).join(' ')).toMatch(/course document/);
});

test('excludes expired and archived batches but keeps future-start batches schedulable', () => {
  const result = generateSchedule(settings, [
    batch({ documentId: 'expired', endDate: '2000-01-01' }),
    batch({ documentId: 'archived', isArchived: true }),
    batch({ documentId: 'future', startDate: '2999-01-01' }),
  ]);
  expect(result.eligibleCount).toBe(1);
  expect(result.report[0].batchDocId).toBe('future');
});

/* --------------------------------------------------------------------------
   Multi-room concurrency + resource utilisation
   -------------------------------------------------------------------------- */

const room = (id, capacity = 30, type = 'Classroom') => ({ id, name: id.toUpperCase(), type, capacity });
const oneHourDay = (rooms) => ({ workingDays: ['Mon'], openTime: '09:00', closeTime: '10:00', slotIncrement: 60, breaks: [], rooms });

test('schedules simultaneous classes in different rooms when rooms and trainers allow it', () => {
  const multi = oneHourDay([room('r1'), room('r2'), room('r3')]);
  const batches = ['a', 'b', 'c'].map((key) => batch({ documentId: `batch-${key}`, teacherId: `trainer-${key}`, teacherName: `T ${key}`, weeklyTeachingHours: 1, capacity: 10 }));
  const result = generateSchedule(multi, batches);
  expect(result.sessions).toHaveLength(3);
  expect(new Set(result.sessions.map((session) => session.roomId)).size).toBe(3);
  expect(result.sessions.every((session) => session.startMinutes === 540 && session.day === 'Mon')).toBe(true);
  expect(result.issues).toHaveLength(0);
  expect(result.unscheduled).toHaveLength(0);
});

test('caps simultaneous classes by available trainers rather than room count', () => {
  const multi = oneHourDay([room('r1'), room('r2'), room('r3')]);
  const batches = [
    batch({ documentId: 'batch-a', teacherId: 'trainer-1', weeklyTeachingHours: 1, capacity: 10 }),
    batch({ documentId: 'batch-b', teacherId: 'trainer-1', weeklyTeachingHours: 1, capacity: 10 }),
    batch({ documentId: 'batch-c', teacherId: 'trainer-2', weeklyTeachingHours: 1, capacity: 10 }),
  ];
  const result = generateSchedule(multi, batches);
  expect(result.sessions).toHaveLength(2);
  expect(result.unscheduled).toHaveLength(1);
  expect(result.sessions.filter((session) => session.teacherId === 'trainer-1')).toHaveLength(1);
});

test('only assigns rooms whose capacity fits the batch', () => {
  const multi = oneHourDay([room('small', 20), room('big', 40)]);
  const result = generateSchedule(multi, [batch({ capacity: 35, weeklyTeachingHours: 1 })]);
  expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0].roomId).toBe('big');
});

test('ignores inactive rooms and reports the batch as unschedulable with a reason', () => {
  const multi = oneHourDay([{ id: 'r1', name: 'R1', type: 'Classroom', capacity: 30, active: false }]);
  const result = generateSchedule(multi, [batch({ weeklyTeachingHours: 1 })]);
  expect(result.sessions).toHaveLength(0);
  expect(result.unscheduled).toHaveLength(1);
  expect(result.unscheduled[0].reason).toMatch(/room|capacity/i);
});

test('distributes different weekly-hour requirements into the correct number of sessions', () => {
  const multi = { workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], openTime: '09:00', closeTime: '18:00', slotIncrement: 30, breaks: [], rooms: [room('r1', 60)] };
  const result = generateSchedule(multi, [
    batch({ documentId: 'h2', teacherId: 't2', weeklyTeachingHours: 2, capacity: 10 }),
    batch({ documentId: 'h3', teacherId: 't3', weeklyTeachingHours: 3, capacity: 10 }),
    batch({ documentId: 'h12', teacherId: 't12', weeklyTeachingHours: 12, capacity: 10 }),
  ]);
  const byBatch = (id) => result.sessions.filter((session) => session.batchDocId === id);
  expect(byBatch('h2').reduce((sum, session) => sum + session.durationMinutes, 0)).toBe(120);
  expect(byBatch('h3').map((session) => session.durationMinutes).sort((a, b) => a - b)).toEqual([60, 120]);
  expect(byBatch('h12')).toHaveLength(6);
  expect(byBatch('h12').every((session) => session.durationMinutes === 120)).toBe(true);
  expect(result.report.every((item) => item.status === 'COMPLETE')).toBe(true);
  // Sessions for the 12-hour batch must be spread across more than one weekday.
  expect(new Set(byBatch('h12').map((session) => session.day)).size).toBeGreaterThan(1);
});

test('keeps sessions inside the operating window and out of configured breaks', () => {
  const multi = { workingDays: ['Mon'], openTime: '09:00', closeTime: '18:00', slotIncrement: 30, breaks: [{ id: 'lunch', name: 'Lunch', enabled: true, startTime: '13:00', endTime: '14:00' }], rooms: [room('r1', 60)] };
  const result = generateSchedule(multi, [batch({ weeklyTeachingHours: 6, capacity: 10 })]);
  expect(result.report[0].status).toBe('COMPLETE');
  for (const session of result.sessions) {
    expect(session.startMinutes).toBeGreaterThanOrEqual(540);
    expect(session.endMinutes).toBeLessThanOrEqual(1080);
    expect(overlaps(session.startMinutes, session.endMinutes, 780, 840)).toBe(false);
  }
});

test('falls back to online rooms for online-only batches instead of demanding a physical room', () => {
  const multi = oneHourDay([room('r1', 30)]);
  const result = generateSchedule(multi, [batch({ learningModes: ['ONLINE'], weeklyTeachingHours: 1, capacity: 5 })]);
  expect(result.report[0].status).toBe('COMPLETE');
  expect(result.sessions[0].roomId).toBe('ONLINE');
});

test('validateSchedule flags room, trainer, and batch double-booking', () => {
  const sessions = [
    { id: 's1', batchDocId: 'batch-a', batchName: 'Batch A', teacherId: 'trainer-a', roomId: 'r1', roomName: 'Room 1', day: 'Mon', startMinutes: 540, endMinutes: 660, durationMinutes: 120 },
    { id: 's2', batchDocId: 'batch-a', batchName: 'Batch A', teacherId: 'trainer-a', roomId: 'r1', roomName: 'Room 1', day: 'Mon', startMinutes: 600, endMinutes: 720, durationMinutes: 120 },
  ];
  const issues = validateSchedule(sessions, [batch()], settings).join(' ');
  expect(issues).toMatch(/Room double-booked/i);
  expect(issues).toMatch(/Trainer double-booked/i);
  expect(issues).toMatch(/Batch double-booked/i);
});

test('computes per-room utilisation from generated sessions', () => {
  const result = generateSchedule(settings, [batch()]);
  expect(result.roomUtilization).toHaveLength(1);
  const [utilisation] = result.roomUtilization;
  expect(utilisation).toMatchObject({ roomId: 'r1', sessions: 1, occupiedHours: 2 });
  // 3 working days x 8 available hours (09:00-18:00 minus the 1h lunch break) = 24 h.
  expect(utilisation.availableHours).toBe(24);
  expect(utilisation.utilization).toBe(8);
});

test('computeRoomUtilization keeps empty rooms visible with zero usage', () => {
  const rows = computeRoomUtilization({ ...settings, rooms: [room('r1'), room('r2', 30)] }, []);
  expect(rows.map((entry) => entry.roomId).sort()).toEqual(['r1', 'r2']);
  expect(rows.every((entry) => entry.sessions === 0 && entry.occupiedHours === 0 && entry.utilization === 0)).toBe(true);
});

test('roomPoolFor filters by capacity, active state, and online eligibility', () => {
  const pool = roomPoolFor({ rooms: [room('small', 5), room('big', 40), { ...room('closed', 40), active: false }] }, batch({ capacity: 20, learningModes: ['OFFLINE', 'ONLINE'] }));
  expect(pool.map((entry) => entry.id).sort()).toEqual(['ONLINE', 'big']);
  expect(activeRooms({ rooms: [{ ...room('x'), active: false }, room('y')] }).map((entry) => entry.id)).toEqual(['y']);
});

test('treats cancelled batches as ineligible and reports them accurately', () => {
  const cancelled = batch({ documentId: 'cancelled', status: 'CANCELLED' });
  const filtered = filterEligibleBatches([cancelled, batch({ documentId: 'live' })]);
  expect(filtered.map((entry) => entry.documentId)).toEqual(['live']);
});

/* --------------------------------------------------------------------------
   Essential regression + presentation-layer checks
   -------------------------------------------------------------------------- */

test('regression: ≥10 batches across 3 rooms and 3 trainers are all fully scheduled', () => {
  const big = {
    workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], openTime: '09:00', closeTime: '18:00', slotIncrement: 30,
    breaks: [{ id: 'lunch', name: 'Lunch', enabled: true, startTime: '13:00', endTime: '14:00' }],
    rooms: [room('r1', 40), room('r2', 40), room('r3', 40)],
  };
  const hoursCycle = [2, 3, 4, 5, 6];
  const many = Array.from({ length: 10 }, (_, index) => batch({
    documentId: `batch-${index}`, batchId: `B${index}`, name: `Batch ${index}`,
    courseDocId: `course-${index % 2}`, courseName: index % 2 ? 'Science' : 'Math',
    teacherId: `trainer-${index % 3}`, teacherName: `Trainer ${index % 3}`,
    capacity: 20 + index, weeklyTeachingHours: hoursCycle[index % 5],
  }));
  const result = generateSchedule(big, many);
  expect(result.eligibleCount).toBe(10);
  expect(result.courseCount).toBe(2);
  expect(result.trainerCount).toBe(3);
  expect(result.roomCount).toBe(3);
  expect(result.unscheduled).toHaveLength(0);
  expect(result.issues).toHaveLength(0);
  expect(result.report.every((item) => item.status === 'COMPLETE' && item.scheduledHours === item.requiredHours)).toBe(true);
  // Every physical room must be used and no room/trainer may be double-booked.
  expect(new Set(result.sessions.map((session) => session.roomId)).size).toBe(3);
  const slots = new Set();
  for (const session of result.sessions) {
    const key = `${session.day}-${session.startMinutes}`;
    expect(session.roomId === 'ONLINE' || !slots.has(`room:${session.roomId}:${key}`)).toBe(true);
    expect(!slots.has(`trainer:${session.teacherId}:${key}`)).toBe(true);
    slots.add(`room:${session.roomId}:${key}`);
    slots.add(`trainer:${session.teacherId}:${key}`);
  }
});

test('weekly view renders every simultaneous session in the shared time cell', () => {
  const uiRooms = [{ id: 'r1', name: 'Room 1', type: 'Classroom', capacity: 30 }, { id: 'r2', name: 'Room 2', type: 'Classroom', capacity: 30 }];
  const roomById = new Map(uiRooms.map((entry) => [entry.id, entry]));
  const simultaneous = [
    { id: 's1', batchDocId: 'batch-a', batchName: 'Batch A', teacherId: 'trainer-a', teacherName: 'Teacher A', roomId: 'r1', roomName: 'Room 1', day: 'Mon', startMinutes: 540, endMinutes: 660, durationMinutes: 120, sessionIndex: 1, status: 'DRAFT' },
    { id: 's2', batchDocId: 'batch-a', batchName: 'Batch A', teacherId: 'trainer-a', teacherName: 'Teacher A', roomId: 'r2', roomName: 'Room 2', day: 'Mon', startMinutes: 540, endMinutes: 660, durationMinutes: 120, sessionIndex: 2, status: 'DRAFT' },
  ];
  render(<WeeklyTimetable profile={{ role: 'OWNER', uid: 'owner' }} batches={[batch()]} sessions={simultaneous} settings={{ ...settings, rooms: uiRooms }} roomById={roomById} conflicts={[]} onEdit={() => {}} onRemove={() => {}} />);
  const cell = document.querySelector('.tt-weekgrid__event');
  expect(cell).not.toBeNull();
  expect(cell.querySelectorAll('article')).toHaveLength(2);
  expect(cell.textContent).toMatch(/Room 1/);
  expect(cell.textContent).toMatch(/Room 2/);
});

test('room-wise view lists every configured room, including empty ones', () => {
  const uiRooms = [{ id: 'r1', name: 'Room 1', type: 'Classroom', capacity: 30 }, { id: 'r2', name: 'Room 2', type: 'Classroom', capacity: 30 }];
  const roomById = new Map(uiRooms.map((entry) => [entry.id, entry]));
  const one = [{ id: 's1', batchDocId: 'batch-a', batchName: 'Batch A', teacherId: 'trainer-a', teacherName: 'Teacher A', roomId: 'r1', roomName: 'Room 1', day: 'Mon', startMinutes: 540, endMinutes: 660, durationMinutes: 120, sessionIndex: 1, status: 'DRAFT' }];
  render(<WeeklyTimetable profile={{ role: 'OWNER', uid: 'owner' }} batches={[batch()]} sessions={one} settings={{ ...settings, rooms: uiRooms }} roomById={roomById} conflicts={[]} onEdit={() => {}} onRemove={() => {}} />);
  fireEvent.click(screen.getByRole('tab', { name: /room-wise/i }));
  expect(screen.getByRole('columnheader', { name: /Room 1/ })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /Room 2/ })).toBeInTheDocument();
  expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
});
