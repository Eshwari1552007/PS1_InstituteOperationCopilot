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

export const ONLINE_ROOM = { id: 'ONLINE', name: 'Online', type: 'Virtual', capacity: 100000 };

const LEGACY_DAY_TO_KEY = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

export const toMinutes = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return NaN;
  const h = Number(match[1]); const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : NaN;
};
export const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
export const dayIndex = (key) => DAYS.findIndex((day) => day.key === (LEGACY_DAY_TO_KEY[key] || key));
export const normalizeDay = (day) => LEGACY_DAY_TO_KEY[day] || day;

export const weeklyHours = (batch) => Number.isInteger(Number(batch?.weeklyTeachingHours)) && Number(batch.weeklyTeachingHours) > 0
  ? Number(batch.weeklyTeachingHours)
  : null;
export const sessionDurations = (batch) => {
  const hours = weeklyHours(batch);
  if (hours) {
    const slots = [];
    for (let remaining = hours; remaining > 0; remaining -= 2) slots.push(Math.min(2, remaining) * 60);
    return slots;
  }
  const legacyHours = Number(batch?.durationHours);
  if (Number.isFinite(legacyHours) && legacyHours > 0 && legacyHours * 60 >= 15 && (legacyHours * 60) % 15 === 0) {
    const count = Math.max(1, Number(batch.sessionsPerWeek || batch.daysOfWeek?.length || 1));
    return Array.from({ length: count }, () => Math.round(legacyHours * 60));
  }
  // Safe legacy mapping: retain fixed times already saved on old batches.
  const oldStart = toMinutes(batch.startTime); const oldEnd = toMinutes(batch.endTime);
  const legacyMinutes = oldEnd - oldStart;
  return Number.isFinite(oldStart) && Number.isFinite(oldEnd) && legacyMinutes >= 15 && legacyMinutes % 15 === 0 ? [legacyMinutes] : [];
};
export const durationMinutes = (batch, sessionIndex = 1) => sessionDurations(batch)[sessionIndex - 1] || null;
export const weeklySessions = (batch) => sessionDurations(batch).length || Math.max(1, (batch.daysOfWeek || []).length || 1);
export const preferredDays = (batch) => {
  const byLegacy = new Map(DAYS.map((day) => [day.legacy, day.key]));
  if (weeklyHours(batch) !== null) return DAYS.map((day) => day.key);
  return (batch.daysOfWeek || []).map((day) => byLegacy.get(day) || day).filter((day) => DAYS.some((item) => item.key === day));
};

/* --------------------------------------------------------------------------
   Resource helpers
   -------------------------------------------------------------------------- */

const isRoomActive = (room) => Boolean(room) && room.active !== false && room.status !== 'INACTIVE';
export const activeRooms = (settings) => (settings?.rooms || []).filter(isRoomActive);
const enabledBreaks = (settings) => (settings?.breaks || []).filter((entry) => entry.enabled);

/** Every room the scheduler may consider for a batch: offline rooms that fit the
 *  batch capacity/type, plus a virtual online room when the batch supports online. */
export function roomPoolFor(settings, batch) {
  const modes = batch.learningModes || ['OFFLINE'];
  const pool = [];
  if (modes.includes('OFFLINE')) {
    pool.push(...activeRooms(settings).filter((room) => Number(room.capacity || 0) >= Number(batch.capacity || 0) && (!batch.roomType || room.type === batch.roomType)));
  }
  if (modes.includes('ONLINE')) pool.push(ONLINE_ROOM);
  return pool;
}

/** All aligned start times on the operating window that fit `duration` and avoid configured breaks. */
export function candidateStarts(settings, duration) {
  const open = toMinutes(settings.openTime); const close = toMinutes(settings.closeTime);
  const increment = Number(settings.slotIncrement) || 30;
  const breaks = enabledBreaks(settings);
  const starts = [];
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open || duration <= 0) return starts;
  for (let start = open; start + duration <= close; start += increment) {
    const end = start + duration;
    if (breaks.some((entry) => overlaps(start, end, toMinutes(entry.startTime), toMinutes(entry.endTime)))) continue;
    starts.push(start);
  }
  return starts;
}

export function filterEligibleBatches(batches) {
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return (batches || []).filter((batch) => !batch.isArchived && !batch.isClosed && !batch.courseArchived
    && !['INACTIVE', 'CLOSED', 'COMPLETED', 'CANCELLED'].includes(batch.status)
    && !['INACTIVE', 'CLOSED', 'COMPLETED', 'CANCELLED'].includes(batch.courseStatus)
    && (!batch.endDate || batch.endDate >= today));
}

/* --------------------------------------------------------------------------
   Settings + manual editing validation
   -------------------------------------------------------------------------- */

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
  for (const item of enabledBreaks(settings)) {
    const start = toMinutes(item.startTime); const end = toMinutes(item.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) errors.push(`${item.name || 'Break'} must have a valid start and end time.`);
    else if (start < open || end > close) errors.push(`${item.name || 'Break'} must be within institute working hours.`);
  }
  const activeBreakWindows = enabledBreaks(settings).map((entry) => ({ start: toMinutes(entry.startTime), end: toMinutes(entry.endTime), name: entry.name || 'Break' }));
  for (let i = 0; i < activeBreakWindows.length; i += 1) for (let j = i + 1; j < activeBreakWindows.length; j += 1) {
    if (overlaps(activeBreakWindows[i].start, activeBreakWindows[i].end, activeBreakWindows[j].start, activeBreakWindows[j].end)) errors.push(`${activeBreakWindows[i].name} overlaps ${activeBreakWindows[j].name}.`);
  }
  return [...new Set(errors)];
}

export function sessionConflicts(draft, sessions, batches, settings, editingId = '') {
  const errors = [];
  const batch = batches.find((item) => item.documentId === draft.batchDocId);
  if (!batch) return ['The batch no longer exists. Refresh timetable data.'];
  const duration = Number(draft.durationMinutes) || durationMinutes(batch, draft.sessionIndex || 1);
  if (!duration) errors.push('Set this batch’s weekly teaching hours in Batch Management before scheduling it.');
  if (weeklyHours(batch) !== null && ![60, 120].includes(duration)) errors.push('Weekly-hours sessions must be one or two whole hours long.');
  if (draft.endMinutes - draft.startMinutes !== duration) errors.push('End time must match the allocated session duration for this batch.');
  if (!settings.workingDays.includes(draft.day)) errors.push(`${draft.day} is not an institute working day.`);
  if ((draft.startMinutes - toMinutes(settings.openTime)) % Number(settings.slotIncrement)) errors.push(`Choose a start time aligned to the ${settings.slotIncrement}-minute slot increment.`);
  if (draft.startMinutes < toMinutes(settings.openTime) || draft.endMinutes > toMinutes(settings.closeTime)) errors.push('The session must fit within institute opening hours.');
  for (const item of enabledBreaks(settings)) {
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

/* --------------------------------------------------------------------------
   Post-generation validation
   -------------------------------------------------------------------------- */

export function validateSchedule(sessions, batches, settings) {
  const issues = [];
  const batchById = new Map((batches || []).map((batch) => [batch.documentId, batch]));
  const roomById = new Map(activeRooms(settings).map((room) => [room.id, room]));
  const breaks = enabledBreaks(settings);
  const open = toMinutes(settings.openTime); const close = toMinutes(settings.closeTime);
  const seen = new Set();
  for (const session of sessions) {
    const batch = batchById.get(session.batchDocId);
    const label = `${batch?.name || session.batchName || session.batchDocId} (${session.day} ${toTime(session.startMinutes)})`;
    const duration = Number(session.durationMinutes || (session.endMinutes - session.startMinutes));
    if (!batch) issues.push(`${label}: references a batch that is not available for scheduling.`);
    if (!session.teacherId) issues.push(`${label}: has no assigned trainer.`);
    if (!settings.workingDays.includes(session.day)) issues.push(`${label}: falls on a day that is not an institute working day.`);
    if (!(session.startMinutes >= open && session.endMinutes <= close)) issues.push(`${label}: is outside institute opening hours.`);
    if (duration <= 0 || session.endMinutes - session.startMinutes !== duration) issues.push(`${label}: has an invalid duration.`);
    for (const item of breaks) if (overlaps(session.startMinutes, session.endMinutes, toMinutes(item.startTime), toMinutes(item.endTime))) issues.push(`${label}: overlaps ${item.name || 'a configured break'}.`);
    if (session.roomId !== 'ONLINE') {
      const room = roomById.get(session.roomId);
      if (!room) issues.push(`${label}: references a room that is not currently available.`);
      else if (Number(room.capacity || 0) < Number(batch?.capacity || 0)) issues.push(`${label}: room ${room.name} capacity is below the batch capacity.`);
    }
    if (seen.has(session.id)) issues.push(`${label}: duplicate session id ${session.id}.`);
    seen.add(session.id);
  }
  for (let i = 0; i < sessions.length; i += 1) for (let j = i + 1; j < sessions.length; j += 1) {
    const a = sessions[i]; const b = sessions[j];
    if (a.day !== b.day || !overlaps(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes)) continue;
    if (a.roomId !== 'ONLINE' && a.roomId === b.roomId) issues.push(`Room double-booked: ${roomById.get(a.roomId)?.name || a.roomId} on ${a.day} ${toTime(a.startMinutes)} (${a.batchName} / ${b.batchName}).`);
    if (a.teacherId && a.teacherId === b.teacherId) issues.push(`Trainer double-booked: ${a.teacherName || a.teacherId} on ${a.day} ${toTime(a.startMinutes)} (${a.batchName} / ${b.batchName}).`);
    if (a.batchDocId === b.batchDocId) issues.push(`Batch double-booked: ${a.batchName} on ${a.day} ${toTime(a.startMinutes)}.`);
  }
  return [...new Set(issues)];
}

export function computeRoomUtilization(settings, sessions) {
  const open = toMinutes(settings.openTime); const close = toMinutes(settings.closeTime);
  const workingDays = (settings.workingDays || []).filter((day) => DAYS.some((item) => item.key === day));
  const dailyMinutes = Number.isFinite(open) && Number.isFinite(close) && close > open ? close - open : 0;
  const breakMinutes = enabledBreaks(settings).reduce((sum, entry) => {
    const start = toMinutes(entry.startTime); const end = toMinutes(entry.endTime);
    return sum + (Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.min(end, close) - Math.max(start, open) : 0);
  }, 0);
  const availablePerRoom = workingDays.length * Math.max(0, dailyMinutes - breakMinutes);
  const summarise = (roomId, name, type, list) => {
    const occupied = list.reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes), 0);
    return {
      roomId, name, type, sessions: list.length,
      occupiedHours: Math.round((occupied / 60) * 10) / 10,
      availableHours: Math.round((availablePerRoom / 60) * 10) / 10,
      utilization: availablePerRoom ? Math.round((occupied / availablePerRoom) * 100) : 0,
    };
  };
  const rows = activeRooms(settings).map((room) => summarise(room.id, room.name, room.type || 'Classroom', sessions.filter((session) => session.roomId === room.id)));
  const online = sessions.filter((session) => session.roomId === 'ONLINE');
  if (online.length) rows.push({ ...summarise('ONLINE', 'Online', 'Virtual', online), availableHours: null, utilization: null });
  return rows;
}

/* --------------------------------------------------------------------------
   Generation engine
   -------------------------------------------------------------------------- */

const NODE_BUDGET = 6000;

function buildReport(eligibleBatches, sessions, unscheduled) {
  return eligibleBatches.map((batch) => {
    const requiredHours = weeklyHours(batch);
    const batchSessions = sessions.filter((session) => session.batchDocId === batch.documentId);
    const scheduledHours = batchSessions.reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes) / 60, 0);
    const issue = unscheduled.find((item) => item.batchDocId === batch.documentId);
    return {
      batchDocId: batch.documentId, batchName: batch.name, courseName: batch.courseName || batch.course || '',
      requiredHours: requiredHours || 0, scheduledHours, missingHours: Math.max(0, (requiredHours || 0) - scheduledHours),
      lectureCount: batchSessions.length,
      status: issue || !requiredHours || scheduledHours !== requiredHours ? (scheduledHours ? 'PARTIAL' : 'UNSCHEDULED') : 'COMPLETE',
      reason: issue?.reason || (!requiredHours ? 'Set a valid weekly teaching-hours requirement.' : scheduledHours > requiredHours ? 'Scheduled sessions exceed the weekly requirement; review manual sessions.' : ''),
    };
  });
}

function totalsFromReport(report) {
  return report.reduce((sum, item) => ({
    requiredHours: sum.requiredHours + item.requiredHours,
    scheduledHours: sum.scheduledHours + item.scheduledHours,
    missingHours: sum.missingHours + item.missingHours,
  }), { requiredHours: 0, scheduledHours: 0, missingHours: 0 });
}

export function generateSchedule(settings, batches, existingSessions = []) {
  const eligibleBatches = filterEligibleBatches(batches);
  const settingsErrors = validateSettings(settings);
  const base = {
    eligibleCount: eligibleBatches.length,
    courseCount: new Set(eligibleBatches.map((batch) => batch.courseDocId).filter(Boolean)).size,
    trainerCount: new Set(eligibleBatches.map((batch) => batch.teacherId).filter(Boolean)).size,
    roomCount: activeRooms(settings).length,
  };
  if (settingsErrors.length) {
    const unscheduled = eligibleBatches.map((batch) => ({
      batchDocId: batch.documentId, name: batch.name, requiredHours: weeklyHours(batch) || 0, scheduledHours: 0,
      unscheduledHours: weeklyHours(batch) || 0, reason: settingsErrors.join(' '),
    }));
    const report = eligibleBatches.map((batch) => ({
      batchDocId: batch.documentId, batchName: batch.name, courseName: batch.courseName || batch.course || '',
      requiredHours: weeklyHours(batch) || 0, scheduledHours: 0, missingHours: weeklyHours(batch) || 0,
      lectureCount: 0, status: 'UNSCHEDULED', reason: settingsErrors.join(' '),
    }));
    return { sessions: [], unscheduled, issues: settingsErrors, roomUtilization: [], totals: totalsFromReport(report), ...base, report };
  }

  // Published and manual sessions are protected: never moved, replaced, or duplicated.
  const sessions = existingSessions.filter((session) => session.status === 'PUBLISHED' || session.source === 'MANUAL').map((session) => ({ ...session }));
  const unscheduled = [];

  // Most-constrained batches first: fewest eligible rooms, then most weekly hours,
  // then largest cohorts, then a stable documentId tie-break.
  const ordered = [...eligibleBatches].sort((a, b) => {
    const roomDelta = roomPoolFor(settings, a).length - roomPoolFor(settings, b).length;
    if (roomDelta) return roomDelta;
    const hoursDelta = (weeklyHours(b) || 0) - (weeklyHours(a) || 0);
    if (hoursDelta) return hoursDelta;
    const capacityDelta = Number(b.capacity || 0) - Number(a.capacity || 0);
    if (capacityDelta) return capacityDelta;
    return String(a.documentId).localeCompare(String(b.documentId));
  });

  for (const batch of ordered) {
    const pool = roomPoolFor(settings, batch);
    const allowedDays = (settings.workingDays || []).filter((day) => DAYS.some((item) => item.key === day));
    const totalRequiredHours = weeklyHours(batch);
    const fail = (reason) => unscheduled.push({
      batchDocId: batch.documentId, name: batch.name, requiredHours: totalRequiredHours || 0, scheduledHours: 0,
      unscheduledHours: totalRequiredHours || 0, reason,
    });

    if (batch.courseStatus === 'MISSING') { fail('The batch references a course document that could not be found. Repair its courseDocId in Batch Management.'); continue; }
    if (!batch.teacherId) { fail('Assign an approved trainer to this batch before scheduling.'); continue; }

    const currentSessions = sessions.filter((session) => session.batchDocId === batch.documentId);
    const requiredMinutes = totalRequiredHours ? totalRequiredHours * 60 : sessionDurations(batch).reduce((sum, minutes) => sum + minutes, 0);
    if (!requiredMinutes) { fail('Missing a valid whole-number weekly teaching-hours requirement. Edit this legacy batch and set it in Batch Management.'); continue; }

    const scheduledBefore = currentSessions.reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes), 0);
    // Prefer whole two-hour sessions, but fall back to one-hour sessions when the
    // operating window can only host a single hour on every working day.
    const chunk = candidateStarts(settings, 120).length ? 120 : 60;
    const durations = [];
    for (let remaining = Math.max(0, requiredMinutes - scheduledBefore); remaining >= 60; remaining -= Math.min(chunk, remaining)) {
      durations.push(Math.min(chunk, remaining));
    }

    const baseIndex = Math.max(0, ...currentSessions.map((session) => Number(session.sessionIndex) || 0));
    const assigned = [];
    let best = [];
    let nodes = 0;

    const candidatesFor = (duration, committed) => {
      const roomUsage = new Map();
      const dayLoad = new Map();
      const batchDayCount = new Map();
      for (const session of committed) {
        roomUsage.set(session.roomId, (roomUsage.get(session.roomId) || 0) + 1);
        dayLoad.set(session.day, (dayLoad.get(session.day) || 0) + 1);
        if (session.batchDocId === batch.documentId) batchDayCount.set(session.day, (batchDayCount.get(session.day) || 0) + 1);
      }
      const days = [...allowedDays].sort((a, b) => (batchDayCount.get(a) || 0) - (batchDayCount.get(b) || 0)
        || (dayLoad.get(a) || 0) - (dayLoad.get(b) || 0) || dayIndex(a) - dayIndex(b));
      const rooms = [...pool].sort((a, b) => (roomUsage.get(a.id) || 0) - (roomUsage.get(b.id) || 0)
        || (a.id === 'ONLINE' ? 1 : 0) - (b.id === 'ONLINE' ? 1 : 0)
        || Number(a.capacity || 0) - Number(b.capacity || 0)
        || String(a.id).localeCompare(String(b.id)));
      const output = [];
      for (const day of days) for (const start of candidateStarts(settings, duration)) for (const room of rooms) {
        output.push({ day, startMinutes: start, endMinutes: start + duration, room });
      }
      return output;
    };

    const place = (index) => {
      if (index >= durations.length) return true;
      if (nodes > NODE_BUDGET) return false;
      for (const candidate of candidatesFor(durations[index], sessions.concat(assigned))) {
        nodes += 1;
        if (nodes > NODE_BUDGET) return false;
        const draft = {
          id: `${batch.documentId}__${baseIndex + index + 1}`,
          batchDocId: batch.documentId, batchId: batch.batchId, batchName: batch.name,
          courseName: batch.courseName || batch.course || '',
          teacherId: batch.teacherId, teacherName: batch.teacherName || '',
          day: candidate.day, startMinutes: candidate.startMinutes, endMinutes: candidate.endMinutes,
          durationMinutes: durations[index], sessionIndex: baseIndex + index + 1,
          roomId: candidate.room.id, roomName: candidate.room.name,
          source: 'GENERATED', status: 'DRAFT',
        };
        if (sessionConflicts(draft, sessions.concat(assigned), batches, settings).length) continue;
        assigned.push(draft);
        if (assigned.length > best.length) best = assigned.slice();
        if (place(index + 1)) return true;
        assigned.pop();
      }
      return false;
    };
    // Keep the fullest achievable set for this batch even when some hours cannot fit.
    const complete = place(0);
    sessions.push(...(complete ? assigned : best));

    const scheduledHours = sessions.filter((session) => session.batchDocId === batch.documentId)
      .reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes) / 60, 0);
    const requiredHours = totalRequiredHours || requiredMinutes / 60;
    if (scheduledHours < requiredHours) {
      const modes = batch.learningModes || ['OFFLINE'];
      const reason = !allowedDays.length ? 'No institute working days are enabled. Configure working days in timetable settings.'
        : !pool.length ? (modes.includes('OFFLINE') ? `No configured room can fit the batch capacity of ${batch.capacity}${modes.includes('ONLINE') ? ' and the batch has no online option.' : '.'}` : 'No online room is available.')
          : `Only ${scheduledHours} of ${requiredHours} teaching hours fit without a teacher, room, batch, break, or working-hours conflict.`;
      unscheduled.push({ batchDocId: batch.documentId, name: batch.name, requiredHours, scheduledHours, unscheduledHours: Math.max(0, requiredHours - scheduledHours), reason });
    }
  }

  const report = buildReport(eligibleBatches, sessions, unscheduled);
  return {
    sessions,
    unscheduled,
    issues: validateSchedule(sessions, batches, settings),
    roomUtilization: computeRoomUtilization(settings, sessions),
    totals: totalsFromReport(report),
    ...base,
    report,
  };
}
