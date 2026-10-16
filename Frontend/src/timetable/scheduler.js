export const DAYS = [
  { key: 'Mon', label: 'Monday', legacy: 'MON' },
  { key: 'Tue', label: 'Tuesday', legacy: 'TUE' },
  { key: 'Wed', label: 'Wednesday', legacy: 'WED' },
  { key: 'Thu', label: 'Thursday', legacy: 'THU' },
  { key: 'Fri', label: 'Friday', legacy: 'FRI' },
  { key: 'Sat', label: 'Saturday', legacy: 'SAT' },
  { key: 'Sun', label: 'Sunday', legacy: 'SUN' },
];

export const DEFAULT_SETTINGS = {
  workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  openTime: '09:00',
  closeTime: '18:00',
  slotIncrement: 30,
  breaks: [{ id: 'break-1', name: 'Lunch', enabled: true, startTime: '13:00', endTime: '14:00' }],
  rooms: [],
};

export const toMinutes = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return NaN;
  const h = Number(match[1]); const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : NaN;
};
export const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
export const durationMinutes = (batch) => {
  const hours = Number(batch.durationHours);
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  // Safe legacy mapping: retain fixed times already saved on old batches.
  const oldStart = toMinutes(batch.startTime); const oldEnd = toMinutes(batch.endTime);
  const legacyMinutes = oldEnd - oldStart;
  return Number.isFinite(oldStart) && Number.isFinite(oldEnd) && legacyMinutes >= 15 && legacyMinutes % 15 === 0 ? legacyMinutes : null;
};
export const weeklySessions = (batch) => {
  const sessions = Number(batch.sessionsPerWeek);
  return Number.isInteger(sessions) && sessions > 0 ? sessions : Math.max(1, (batch.daysOfWeek || []).length || 1);
};
export const preferredDays = (batch) => {
  const byLegacy = new Map(DAYS.map((day) => [day.legacy, day.key]));
  return (batch.daysOfWeek || []).map((day) => byLegacy.get(day) || day).filter((day) => DAYS.some((item) => item.key === day));
};

export function validateSettings(settings) {
  const errors = [];
  const open = toMinutes(settings.openTime); const close = toMinutes(settings.closeTime);
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) errors.push('Institute closing time must be later than opening time.');
  if (![15, 30, 60].includes(Number(settings.slotIncrement))) errors.push('Choose a 15, 30, or 60 minute slot increment.');
  if (!settings.workingDays?.length) errors.push('Select at least one working day.');
  const roomNames = (settings.rooms || []).map((room) => String(room.name || '').trim().toLowerCase());
  if (roomNames.some((name) => !name)) errors.push('Every room must have a name.');
  if (new Set(roomNames).size !== roomNames.length) errors.push('Room names must be unique.');
  if ((settings.rooms || []).some((room) => !Number.isFinite(Number(room.capacity)) || Number(room.capacity) < 1)) errors.push('Every room needs a positive capacity.');
  for (const item of (settings.breaks || []).filter((entry) => entry.enabled)) {
    const start = toMinutes(item.startTime); const end = toMinutes(item.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push(`${item.name || 'Break'} must have a valid start and end time.`);
    else if (start < open || end > close) errors.push(`${item.name || 'Break'} must be within institute working hours.`);
  }
  const activeBreaks = (settings.breaks || []).filter((entry) => entry.enabled).map((entry) => ({ start: toMinutes(entry.startTime), end: toMinutes(entry.endTime), name: entry.name || 'Break' }));
  for (let i = 0; i < activeBreaks.length; i += 1) for (let j = i + 1; j < activeBreaks.length; j += 1) {
    if (overlaps(activeBreaks[i].start, activeBreaks[i].end, activeBreaks[j].start, activeBreaks[j].end)) errors.push(`${activeBreaks[i].name} overlaps ${activeBreaks[j].name}.`);
  }
  return [...new Set(errors)];
}

export function sessionConflicts(draft, sessions, batches, settings, editingId = '') {
  const errors = [];
  const batch = batches.find((item) => item.documentId === draft.batchDocId);
  if (!batch) return ['The batch no longer exists. Refresh timetable data.'];
  const duration = durationMinutes(batch);
  if (!duration) errors.push('Set this batch’s class duration in Batch Management before scheduling it.');
  if (draft.endMinutes - draft.startMinutes !== duration) errors.push('End time must match the batch’s required class duration.');
  if (!settings.workingDays.includes(draft.day)) errors.push(`${draft.day} is not an institute working day.`);
  if (draft.startMinutes < toMinutes(settings.openTime) || draft.endMinutes > toMinutes(settings.closeTime)) errors.push('The session must fit within institute opening hours.');
  for (const item of (settings.breaks || []).filter((entry) => entry.enabled)) {
    if (overlaps(draft.startMinutes, draft.endMinutes, toMinutes(item.startTime), toMinutes(item.endTime))) errors.push(`The session overlaps ${item.name || 'a break'}.`);
  }
  const room = (settings.rooms || []).find((item) => item.id === draft.roomId);
  if (draft.roomId !== 'ONLINE') {
    if (!room) errors.push('Choose an available room.');
    else if (Number(room.capacity) < Number(batch.capacity || 0)) errors.push(`${room.name} capacity is below this batch’s maximum capacity (${batch.capacity}).`);
    else if (batch.roomType && room.type !== batch.roomType) errors.push(`${batch.name} requires a ${batch.roomType} room.`);
  }
  for (const other of sessions.filter((item) => item.id !== editingId && item.day === draft.day && overlaps(draft.startMinutes, draft.endMinutes, item.startMinutes, item.endMinutes))) {
    if (draft.roomId !== 'ONLINE' && other.roomId === draft.roomId) errors.push(`Room ${room?.name || ''} is booked during this time.`);
    if (other.teacherId === (draft.teacherId || batch.teacherId)) errors.push('This teacher has another class during this time.');
    if (other.batchDocId === draft.batchDocId) errors.push('This batch already has a class during this time.');
  }
  return [...new Set(errors)];
}

export function generateSchedule(settings, batches, existingSessions = []) {
  const errors = validateSettings(settings);
  if (errors.length) return { sessions: [], unscheduled: batches.map((batch) => ({ batchDocId: batch.documentId, name: batch.name, reason: errors.join(' ') })) };
  const protectedSessions = existingSessions.filter((session) => session.status === 'PUBLISHED' || session.source === 'MANUAL');
  const sessions = protectedSessions.map((session) => ({ ...session }));
  const unscheduled = [];
  const settingsBreaks = (settings.breaks || []).filter((entry) => entry.enabled);
  const batchesSorted = batches.filter((batch) => !batch.isArchived && !batch.isClosed && !['INACTIVE', 'CLOSED', 'COMPLETED'].includes(batch.status))
    .sort((a, b) => preferredDays(a).length - preferredDays(b).length || durationMinutes(b) - durationMinutes(a) || b.capacity - a.capacity || a.documentId.localeCompare(b.documentId));
  for (const batch of batchesSorted) {
    const duration = durationMinutes(batch);
    if (!duration) { unscheduled.push({ batchDocId: batch.documentId, name: batch.name, reason: 'Missing class duration. Edit this legacy batch and set Class duration in hours.' }); continue; }
    const needed = weeklySessions(batch);
    const current = sessions.filter((item) => item.batchDocId === batch.documentId).length;
    const allowedDays = settings.workingDays.filter((day) => !preferredDays(batch).length || preferredDays(batch).includes(day));
    const mode = (batch.learningModes || ['OFFLINE']).includes('OFFLINE') ? 'OFFLINE' : 'ONLINE';
    const availableRooms = mode === 'ONLINE' ? [{ id: 'ONLINE', name: 'Online', capacity: 100000, type: 'Virtual' }] : (settings.rooms || []).filter((room) => Number(room.capacity) >= Number(batch.capacity || 0) && (!batch.roomType || room.type === batch.roomType));
    const legacyStart = toMinutes(batch.startTime);
    const starts = [];
    for (let start = toMinutes(settings.openTime); start + duration <= toMinutes(settings.closeTime); start += Number(settings.slotIncrement)) starts.push(start);
    if (Number.isFinite(legacyStart)) starts.sort((a, b) => Math.abs(a - legacyStart) - Math.abs(b - legacyStart) || a - b);
    for (let index = current + 1; index <= needed; index += 1) {
      let found = null;
      for (const day of allowedDays) {
        for (const start of starts) {
          if (start + duration > toMinutes(settings.closeTime)) continue;
          const end = start + duration;
          if (settingsBreaks.some((entry) => overlaps(start, end, toMinutes(entry.startTime), toMinutes(entry.endTime)))) continue;
          for (const room of availableRooms) {
            const draft = { batchDocId: batch.documentId, teacherId: batch.teacherId, day, startMinutes: start, endMinutes: end, roomId: room.id };
            if (!sessionConflicts(draft, sessions, batches, settings).length) { found = { ...draft, roomName: room.name, durationMinutes: duration, source: 'GENERATED', status: 'DRAFT', sessionIndex: index, id: `${batch.documentId}__${index}` }; break; }
          }
          if (found) break;
        }
        if (found) break;
      }
      if (found) sessions.push(found);
      else break;
    }
    const totalNow = sessions.filter((item) => item.batchDocId === batch.documentId).length;
    if (totalNow < needed) {
      const reason = !allowedDays.length ? 'No working day matches this batch’s preferred class days.'
        : !availableRooms.length ? (mode === 'OFFLINE' ? `No configured room can fit the batch capacity of ${batch.capacity}.` : 'No online room is available.')
          : `Only ${totalNow} of ${needed} weekly session(s) could fit without a teacher, room, batch, break, or working-hours conflict.`;
      unscheduled.push({ batchDocId: batch.documentId, name: batch.name, reason });
    }
  }
  return { sessions, unscheduled };
}
