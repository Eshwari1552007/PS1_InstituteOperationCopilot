import { durationMinutes, generateSchedule, overlaps, sessionConflicts, weeklyHours } from './scheduler';

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

test('fills parallel classrooms for many batches and exposes room/trainer utilization', () => {
  const multiRoomSettings = {
    ...settings,
    workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    closeTime: '20:00',
    breaks: [],
    rooms: Array.from({ length: 4 }, (_, index) => ({ id: `r${index + 1}`, name: `Room ${index + 1}`, type: 'Classroom', capacity: 30 })),
  };
  const batches = Array.from({ length: 12 }, (_, index) => batch({
    documentId: `parallel-${index}`,
    courseDocId: `course-${index % 3}`,
    courseName: `Course ${index % 3}`,
    teacherId: `teacher-${index}`,
    weeklyTeachingHours: index % 3 === 0 ? 4 : index % 3 === 1 ? 2 : 1,
  }));
  const result = generateSchedule(multiRoomSettings, batches);
  expect(result.unscheduled).toHaveLength(0);
  expect(result.report.every((item) => item.status === 'COMPLETE')).toBe(true);
  expect(new Set(result.sessions.map((item) => item.roomId)).size).toBeGreaterThan(1);
  expect(result.roomUtilization).toHaveLength(4);
  expect(result.trainerUtilization).toHaveLength(12);
  const concurrent = result.sessions.filter((session) => session.day === 'Mon' && session.startMinutes === result.sessions[0].startMinutes);
  expect(new Set(concurrent.map((item) => item.roomId)).size).toBe(concurrent.length);
});

test('respects inactive rooms, room hours, and trainer availability while using other valid rooms', () => {
  const limited = {
    ...settings,
    workingDays: ['Mon', 'Tue'],
    closeTime: '18:00',
    breaks: [],
    rooms: [
      { id: 'closed', name: 'Closed', type: 'Classroom', capacity: 30, isActive: false },
      { id: 'morning', name: 'Morning', type: 'Classroom', capacity: 30, availableDays: ['Mon'], availableStartTime: '09:00', availableEndTime: '12:00' },
      { id: 'afternoon', name: 'Afternoon', type: 'Classroom', capacity: 30, availableDays: ['Tue'], availableStartTime: '13:00', availableEndTime: '18:00' },
    ],
  };
  const constrained = batch({ weeklyTeachingHours: 2, trainerAvailability: { availableDays: ['Tue'], startTime: '13:00', endTime: '18:00' } });
  const result = generateSchedule(limited, [constrained], [], [{ uid: 'trainer-a', availability: constrained.trainerAvailability }]);
  expect(result.unscheduled).toHaveLength(0);
  expect(result.sessions[0]).toMatchObject({ day: 'Tue', roomId: 'afternoon' });
  expect(result.sessions[0].roomId).not.toBe('closed');
});

test('does not place simultaneous sessions for the same trainer or batch', () => {
  const multiRoomSettings = { ...settings, workingDays: ['Mon'], closeTime: '14:00', breaks: [], rooms: [1, 2, 3].map((n) => ({ id: `room-${n}`, name: `Room ${n}`, type: 'Classroom', capacity: 30 })) };
  const batches = Array.from({ length: 3 }, (_, index) => batch({ documentId: `same-trainer-${index}`, teacherId: index < 2 ? 'shared-trainer' : 'other-trainer', weeklyTeachingHours: 2 }));
  const result = generateSchedule(multiRoomSettings, batches);
  expect(result.sessions).toHaveLength(3);
  for (const session of result.sessions) expect(sessionConflicts(session, result.sessions, batches, multiRoomSettings, session.id)).toEqual([]);
});

test('schedules consecutive two-hour classes across the configured day without crossing breaks', () => {
  const daySettings = { ...settings, workingDays: ['Mon', 'Tue'], openTime: '08:00', closeTime: '18:00', breaks: [{ id: 'lunch', name: 'Lunch', enabled: true, startTime: '13:00', endTime: '14:00' }] };
  const batches = [batch({ documentId: 'early', teacherId: 'teacher-1' }), batch({ documentId: 'next', teacherId: 'teacher-2' }), batch({ documentId: 'afternoon', teacherId: 'teacher-3' })];
  const result = generateSchedule(daySettings, batches);
  const [first, second, third] = result.sessions.sort((a, b) => a.startMinutes - b.startMinutes);
  expect(first).toMatchObject({ day: 'Mon', startMinutes: 480, endMinutes: 600, durationMinutes: 120 });
  expect(second).toMatchObject({ day: 'Mon', startMinutes: 600, endMinutes: 720, durationMinutes: 120 });
  expect(third).toMatchObject({ day: 'Mon', startMinutes: 840, endMinutes: 960, durationMinutes: 120 });
  expect(result.sessions.every((session) => !(session.startMinutes < 840 && session.endMinutes > 780))).toBe(true);
  expect(result.sessions.every((session) => session.startMinutes >= 480 && session.endMinutes <= 1080)).toBe(true);
});

test('schedules one hybrid lecture for mixed online and offline enrollees using a physical room', () => {
  const hybrid = batch({ capacity: 25, enrolledCount: 25, offlineEnrolledCount: 15, learningModes: ['ONLINE', 'OFFLINE'], onlineClassDetails: 'https://meet.example/class' });
  const hybridSettings = { ...settings, rooms: [{ id: 'r1', name: 'Room 1', type: 'Classroom', capacity: 20 }] };
  const result = generateSchedule(hybridSettings, [hybrid]);
  expect(result.unscheduled).toHaveLength(0);
  expect(result.sessions).toHaveLength(1);
  expect(result.sessions[0]).toMatchObject({ roomId: 'r1', deliveryMode: 'HYBRID', onlineClassDetails: hybrid.onlineClassDetails });
});

test('reports mixed-mode batches without an online classroom configuration', () => {
  const hybrid = batch({ enrolledCount: 25, offlineEnrolledCount: 15, learningModes: ['ONLINE', 'OFFLINE'], onlineClassDetails: '' });
  const result = generateSchedule(settings, [hybrid]);
  expect(result.sessions).toHaveLength(0);
  expect(result.unscheduled[0].reason).toMatch(/online classroom details/i);
});
