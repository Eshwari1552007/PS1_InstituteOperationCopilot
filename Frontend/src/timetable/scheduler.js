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
  timeZone: 'Asia/Kolkata',
  slotIncrement: 30,
  breaks: [{ id: 'break-1', name: 'Lunch', enabled: true, startTime: '13:00', endTime: '14:00' }],
  rooms: [],
  holidays: [],
};

export const toMinutes = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return NaN;
  const h = Number(match[1]); const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : NaN;
};
export const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
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

export function getParticipantModes(batch = {}) {
  const modes = batch.learningModes || ['OFFLINE'];
  const enrolled = Number(batch.enrolledCount || 0);
  const offline = Number(batch.offlineEnrolledCount ?? (modes.includes('OFFLINE') ? enrolled : 0));
  const online = Math.max(0, enrolled - offline);
  if (offline > 0 && online > 0) return modes.includes('OFFLINE') && modes.includes('ONLINE') ? 'HYBRID' : 'INVALID_HYBRID';
  if (online > 0) return modes.includes('ONLINE') ? 'ONLINE' : 'INVALID_HYBRID';
  if (offline > 0) return modes.includes('OFFLINE') ? 'OFFLINE' : 'INVALID_HYBRID';
  if (modes.length === 1) return modes[0];
  return 'UNSPECIFIED';
}

export const roomCapacityRequired = (batch = {}) => getParticipantModes(batch) === 'HYBRID'
  ? Number(batch.offlineEnrolledCount || 0)
  : Number(batch.capacity || 0);

export const isRoomActive = (room) => room && room.isArchived !== true && room.isActive !== false
  && !['INACTIVE', 'CLOSED', 'ARCHIVED'].includes(String(room.status || '').toUpperCase());

export const getEligibleRooms = (settings) => (settings.rooms || []).filter(isRoomActive);

const normalizedDay = (day) => ({ MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' }[String(day || '').slice(0, 3).toUpperCase()] || day);
const availabilityForDay = (availability, day) => {
  if (!availability) return null;
  if (Array.isArray(availability)) return { days: availability };
  const key = normalizedDay(day);
  const dayWindows = availability[key] ?? availability[String(key).toUpperCase()] ?? availability[{ Mon: 'MON', Tue: 'TUE', Wed: 'WED', Thu: 'THU', Fri: 'FRI', Sat: 'SAT', Sun: 'SUN' }[key]];
  return { ...availability, ...(dayWindows ? (Array.isArray(dayWindows) ? { windows: dayWindows } : dayWindows) : {}) };
};

function fitsAvailability(availability, day, start, end) {
  if (!availability) return true;
  const item = availabilityForDay(availability, day) || {};
  const days = item.days || item.availableDays || item.workingDays || item.weekdays;
  if (Array.isArray(days) && !days.map(normalizedDay).includes(day)) return false;
  if (item.unavailableDays?.map(normalizedDay).includes(day)) return false;
  const availableStart = item.startTime || item.availableStartTime;
  const availableEnd = item.endTime || item.availableEndTime;
  if (availableStart && start < toMinutes(availableStart)) return false;
  if (availableEnd && end > toMinutes(availableEnd)) return false;
  if (item.isActive === false || item.isArchived === true || ['INACTIVE', 'CLOSED', 'ARCHIVED'].includes(String(item.status || '').toUpperCase())) return false;
  if (Array.isArray(item.windows) && !item.windows.some((window) => start >= toMinutes(window.startTime || window.start) && end <= toMinutes(window.endTime || window.end))) return false;
  return true;
}

export function validateSettings(settings) {
  const errors = [];
  const open = toMinutes(settings.openTime); const close = toMinutes(settings.closeTime);
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) errors.push('Institute closing time must be later than opening time.');
  if (![15, 30, 60].includes(Number(settings.slotIncrement))) errors.push('Choose a 15, 30, or 60 minute slot increment.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: settings.timeZone || 'Asia/Kolkata' }); }
  catch { errors.push('Enter a valid IANA institute time zone, such as Asia/Kolkata.'); }
  if (!settings.workingDays?.length) errors.push('Select at least one working day.');
  const roomNames = (settings.rooms || []).map((room) => String(room.name || '').trim().toLowerCase());
  if (roomNames.some((name) => !name)) errors.push('Every room must have a name.');
  if (new Set(roomNames).size !== roomNames.length) errors.push('Room names must be unique.');
  if ((settings.rooms || []).some((room) => !Number.isFinite(Number(room.capacity)) || Number(room.capacity) < 1)) errors.push('Every room needs a positive capacity.');
  for (const room of getEligibleRooms(settings)) {
    if (room.availableStartTime && !Number.isFinite(toMinutes(room.availableStartTime))) errors.push(`${room.name} has an invalid available start time.`);
    if (room.availableEndTime && !Number.isFinite(toMinutes(room.availableEndTime))) errors.push(`${room.name} has an invalid available end time.`);
  }
  if ((settings.holidays || []).some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) errors.push('Holiday dates must use YYYY-MM-DD format.');
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

export function sessionConflicts(draft, sessions, batches, settings, editingId = '', trainers = []) {
  const errors = [];
  const batch = batches.find((item) => item.documentId === draft.batchDocId);
  if (!batch) return ['The batch no longer exists. Refresh timetable data.'];
  const duration = Number(draft.durationMinutes) || durationMinutes(batch, draft.sessionIndex || 1);
  if (!duration) errors.push('Set this batch’s weekly teaching hours in Batch Management before scheduling it.');
  if (weeklyHours(batch) !== null && ![60, 120].includes(duration)) errors.push('Weekly-hours sessions must be one or two whole hours long.');
  if (draft.endMinutes - draft.startMinutes !== duration) errors.push('End time must match the allocated session duration for this batch.');
  const allowedDays = (batch.availableDays || batch.permittedDays || settings.workingDays).map(normalizedDay);
  if (!settings.workingDays.map(normalizedDay).includes(draft.day) || !allowedDays.includes(draft.day)) errors.push(`${draft.day} is not an institute or batch working day.`);
  if ((draft.startMinutes - toMinutes(settings.openTime)) % Number(settings.slotIncrement)) errors.push(`Choose a start time aligned to the ${settings.slotIncrement}-minute slot increment.`);
  if (draft.startMinutes < toMinutes(settings.openTime) || draft.endMinutes > toMinutes(settings.closeTime)) errors.push('The session must fit within institute opening hours.');
  const teacher = trainers.find((item) => item.uid === (draft.teacherId || batch.teacherId));
  const teacherAvailability = batch.trainerAvailability || teacher?.availability || teacher?.teachingAvailability;
  if (!fitsAvailability(teacherAvailability, draft.day, draft.startMinutes, draft.endMinutes)) errors.push('The assigned trainer is unavailable at this time.');
  for (const item of (settings.breaks || []).filter((entry) => entry.enabled)) {
    if (overlaps(draft.startMinutes, draft.endMinutes, toMinutes(item.startTime), toMinutes(item.endTime))) errors.push(`The session overlaps ${item.name || 'a break'}.`);
  }
  const modes = batch.learningModes || ['OFFLINE'];
  if (draft.deliveryMode === 'HYBRID' && (!modes.includes('ONLINE') || !modes.includes('OFFLINE'))) errors.push('Hybrid delivery requires both online and offline modes on the batch.');
  if (draft.deliveryMode === 'HYBRID' && !String(draft.onlineClassDetails || batch.onlineClassDetails || '').trim()) errors.push('Add online classroom details to this mixed-mode batch before scheduling.');
  if (draft.roomId === 'ONLINE' && !modes.includes('ONLINE')) errors.push('This batch is not configured for online learning.');
  if (draft.roomId !== 'ONLINE' && !modes.includes('OFFLINE')) errors.push('This batch is not configured for in-person learning.');
  const room = (settings.rooms || []).find((item) => item.id === draft.roomId && isRoomActive(item));
  if (draft.roomId !== 'ONLINE') {
    if (!room) errors.push('Choose an available room.');
    else if (Number(room.capacity) < roomCapacityRequired(batch)) errors.push(`${room.name} capacity is below this batch’s in-person seat requirement (${roomCapacityRequired(batch)}).`);
    else if (batch.roomType && room.type !== batch.roomType) errors.push(`${batch.name} requires a ${batch.roomType} room.`);
    else if (!fitsAvailability(room.availability || room, draft.day, draft.startMinutes, draft.endMinutes)) errors.push(`${room.name} is unavailable at this time.`);
  }
  for (const other of sessions.filter((item) => item.id !== editingId && item.day === draft.day && overlaps(draft.startMinutes, draft.endMinutes, item.startMinutes, item.endMinutes))) {
    if (draft.roomId !== 'ONLINE' && other.roomId === draft.roomId) errors.push(`Room ${room?.name || ''} is booked during this time.`);
    if (other.teacherId === (draft.teacherId || batch.teacherId)) errors.push('This teacher has another class during this time.');
    if (other.batchDocId === draft.batchDocId) errors.push('This batch already has a class during this time.');
  }
  return [...new Set(errors)];
}

export function generateSchedule(settings, batches, existingSessions = [], trainers = [], options = {}) {
  const localToday = (() => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; })();
  const eligibleBatches = batches.filter((batch) => !batch.isArchived && !batch.isClosed && !batch.courseArchived
    && !['INACTIVE', 'CLOSED', 'COMPLETED', 'CANCELLED'].includes(batch.status)
    && !['INACTIVE', 'CLOSED', 'COMPLETED', 'CANCELLED'].includes(batch.courseStatus)
    && (!batch.endDate || batch.endDate >= localToday));
  const errors = validateSettings(settings);
  if (errors.length) {
    const unscheduled = eligibleBatches.map((batch) => ({ batchDocId: batch.documentId, name: batch.name, reason: errors.join(' ') }));
    return { sessions: [], unscheduled, eligibleCount: eligibleBatches.length, courseCount: new Set(eligibleBatches.map((batch) => batch.courseDocId).filter(Boolean)).size,
      report: eligibleBatches.map((batch) => ({ batchDocId: batch.documentId, batchName: batch.name, courseName: batch.courseName || batch.course || '', requiredHours: weeklyHours(batch) || 0, scheduledHours: 0, missingHours: weeklyHours(batch) || 0, lectureCount: 0, status: 'UNSCHEDULED', reason: errors.join(' ') })) };
  }
  const protectedSessions = existingSessions.filter((session) => session.status === 'PUBLISHED' || session.source === 'MANUAL');
  const sessions = protectedSessions.map((session) => ({ ...session }));
  const unscheduled = [];
  const settingsBreaks = (settings.breaks || []).filter((entry) => entry.enabled);
  const jobs = [];
  const batchesSorted = [...eligibleBatches].sort((a, b) => {
    const roomCount = (batch) => {
      const modes = batch.learningModes || ['OFFLINE'];
      const physical = modes.includes('OFFLINE') ? getEligibleRooms(settings).filter((room) => Number(room.capacity) >= roomCapacityRequired(batch) && (!batch.roomType || room.type === batch.roomType)).length : 0;
      return physical + (modes.includes('ONLINE') ? 1 : 0);
    };
    return roomCount(a) - roomCount(b) || (preferredDays(a).length || settings.workingDays.length) - (preferredDays(b).length || settings.workingDays.length)
      || (weeklyHours(b) || 0) - (weeklyHours(a) || 0) || Number(b.capacity || 0) - Number(a.capacity || 0) || a.documentId.localeCompare(b.documentId);
  });
  for (const batch of batchesSorted) {
    const allocations = sessionDurations(batch);
    const totalRequiredHours = weeklyHours(batch);
    if (batch.courseStatus === 'MISSING') { unscheduled.push({ batchDocId: batch.documentId, name: batch.name, requiredHours: totalRequiredHours || 0, scheduledHours: 0, unscheduledHours: totalRequiredHours || 0, reason: 'The batch references a course document that could not be found. Repair its courseDocId in Batch Management.' }); continue; }
    if (!batch.teacherId) { unscheduled.push({ batchDocId: batch.documentId, name: batch.name, requiredHours: totalRequiredHours || 0, scheduledHours: 0, unscheduledHours: totalRequiredHours || 0, reason: 'Assign an approved trainer to this batch before scheduling.' }); continue; }
    if (!allocations.length) { unscheduled.push({ batchDocId: batch.documentId, name: batch.name, requiredHours: totalRequiredHours || 0, scheduledHours: 0, unscheduledHours: totalRequiredHours || 0, reason: 'Missing a valid whole-number weekly teaching-hours requirement. Edit this legacy batch and set it in Batch Management.' }); continue; }
    const participantModes = getParticipantModes(batch);
    if (participantModes === 'INVALID_HYBRID') { unscheduled.push({ batchDocId: batch.documentId, name: batch.name, requiredHours: totalRequiredHours || 0, scheduledHours: 0, unscheduledHours: totalRequiredHours || 0, reason: 'This batch has both online and offline students but does not offer both learning modes. Update its supported modes.' }); continue; }
    if (participantModes === 'HYBRID' && !String(batch.onlineClassDetails || '').trim()) { unscheduled.push({ batchDocId: batch.documentId, name: batch.name, requiredHours: totalRequiredHours || 0, scheduledHours: 0, unscheduledHours: totalRequiredHours || 0, reason: 'Mixed online/offline students need online classroom details on this batch before a hybrid lecture can be scheduled.' }); continue; }
    const currentSessions = sessions.filter((item) => item.batchDocId === batch.documentId);
    const requiredHours = totalRequiredHours || allocations.reduce((sum, minutes) => sum + minutes / 60, 0);
    const scheduledBefore = currentSessions.reduce((sum, item) => sum + Number(item.durationMinutes || item.endMinutes - item.startMinutes), 0);
    let remainingMinutes = Math.max(0, requiredHours * 60 - scheduledBefore);
    let nextIndex = Math.max(0, ...currentSessions.map((item) => Number(item.sessionIndex) || 0)) + 1;
    while (remainingMinutes >= 60) {
      const duration = Math.min(120, remainingMinutes);
      jobs.push({ batch, duration, sessionIndex: nextIndex });
      nextIndex += 1;
      remainingMinutes -= duration;
    }
  }
  // Search all day/time/room combinations. The deterministic score packs
  // compatible trainers into parallel rooms while spreading a batch's own
  // lectures across weekdays. Bounded backtracking revises earlier choices
  // whenever those choices prevent a later, more constrained class.
  const jobCandidates = (job) => {
    const { batch, duration, sessionIndex } = job;
    const days = (batch.availableDays || batch.permittedDays || settings.workingDays).map(normalizedDay);
    const allowedDays = settings.workingDays.map(normalizedDay).filter((day) => days.includes(day));
    const modes = batch.learningModes || ['OFFLINE'];
    const participantMode = getParticipantModes(batch);
    const rooms = [
      ...((participantMode === 'HYBRID' || participantMode === 'OFFLINE' || (participantMode === 'UNSPECIFIED' && modes.includes('OFFLINE'))) ? getEligibleRooms(settings).filter((room) => Number(room.capacity) >= roomCapacityRequired(batch) && (!batch.roomType || room.type === batch.roomType)) : []),
      ...((participantMode === 'ONLINE' || (participantMode === 'UNSPECIFIED' && modes.includes('ONLINE'))) ? [{ id: 'ONLINE', name: 'Online', capacity: Number.MAX_SAFE_INTEGER, type: 'Virtual' }] : []),
    ];
    const preferredRoomName = String(batch.roomNumber || '').trim().toLowerCase();
    const candidates = [];
    for (const day of allowedDays) for (const start of starts) {
      const durations = duration === 120 ? [120, 60] : [duration];
      for (const candidateDuration of durations) {
      const end = start + candidateDuration;
      if (end > toMinutes(settings.closeTime) || settingsBreaks.some((item) => overlaps(start, end, toMinutes(item.startTime), toMinutes(item.endTime)))) continue;
      for (const room of rooms) {
        const deliveryMode = participantMode === 'HYBRID' ? 'HYBRID' : room.id === 'ONLINE' ? 'ONLINE' : 'OFFLINE';
        const draft = { id: `${batch.documentId}__${sessionIndex}`, batchDocId: batch.documentId, batchId: batch.batchId, batchName: batch.name, courseName: batch.courseName || batch.course || '', teacherId: batch.teacherId, teacherName: batch.teacherName || '', day, startMinutes: start, endMinutes: end, durationMinutes: candidateDuration, roomId: room.id, roomName: room.name, deliveryMode, ...(deliveryMode === 'HYBRID' || deliveryMode === 'ONLINE' ? { onlineClassDetails: batch.onlineClassDetails || '' } : {}), sessionIndex, source: 'GENERATED', status: 'DRAFT' };
        if (sessionConflicts(draft, sessions, batches, settings, '', trainers).length) continue;
        const ownDayCount = sessions.filter((item) => item.batchDocId === batch.documentId && normalizedDay(item.day) === day).length;
        const exactSlotCount = sessions.filter((item) => normalizedDay(item.day) === day && overlaps(start, end, item.startMinutes, item.endMinutes) && item.roomId !== 'ONLINE' && room.id !== 'ONLINE').length;
        const dayLoad = sessions.filter((item) => normalizedDay(item.day) === day).length;
        const roomHours = room.id === 'ONLINE' ? 0 : sessions.filter((item) => item.roomId === room.id).reduce((sum, item) => sum + Number(item.durationMinutes || item.endMinutes - item.startMinutes), 0);
        const preferredRoomPenalty = preferredRoomName && room.name.toLowerCase() !== preferredRoomName ? 1 : 0;
        const canRunParallel = rooms.length > 1 && room.id !== 'ONLINE';
        // With one physical room, pack the working week from the first day and
        // fill its next available time before moving on. With multiple rooms,
        // preserve the ability to run independent classes side by side.
        const score = canRunParallel
          ? [-exactSlotCount, allowedDays.indexOf(day), ownDayCount, start, preferredRoomPenalty, roomHours, String(room.id)]
          : [allowedDays.indexOf(day), start, ownDayCount, dayLoad, preferredRoomPenalty, roomHours, String(room.id)];
        candidates.push({ draft, score });
      }
      }
    }
    candidates.sort((a, b) => {
      if (a.draft.durationMinutes !== b.draft.durationMinutes) return b.draft.durationMinutes - a.draft.durationMinutes;
      for (let index = 0; index < a.score.length; index += 1) {
        const comparison = typeof a.score[index] === 'string' ? a.score[index].localeCompare(b.score[index]) : a.score[index] - b.score[index];
        if (comparison) return comparison;
      }
      return 0;
    });
    return candidates.map((item) => item.draft);
  };
  const orderedJobs = jobs.sort((a, b) => {
    const aDays = (a.batch.availableDays || a.batch.permittedDays || settings.workingDays).length;
    const bDays = (b.batch.availableDays || b.batch.permittedDays || settings.workingDays).length;
    const aRooms = getEligibleRooms(settings).filter((room) => Number(room.capacity) >= roomCapacityRequired(a.batch)).length + ((a.batch.learningModes || ['OFFLINE']).includes('ONLINE') ? 1 : 0);
    const bRooms = getEligibleRooms(settings).filter((room) => Number(room.capacity) >= roomCapacityRequired(b.batch)).length + ((b.batch.learningModes || ['OFFLINE']).includes('ONLINE') ? 1 : 0);
    return aDays - bDays || aRooms - bRooms || b.duration - a.duration || a.sessionIndex - b.sessionIndex || a.batch.documentId.localeCompare(b.batch.documentId);
  });
  const starts = [];
  for (let start = toMinutes(settings.openTime); start < toMinutes(settings.closeTime); start += Number(settings.slotIncrement)) starts.push(start);
  const baseSessions = sessions.slice(); const nodeLimit = options.nodeLimit || 30000; let visited = 0; let bestSessions = baseSessions.slice(); let bestDepth = 0;
  const search = (position) => {
    if (position > bestDepth) { bestDepth = position; bestSessions = sessions.slice(); }
    if (position >= orderedJobs.length) return true;
    if (visited >= nodeLimit) return false;
    const job = orderedJobs[position];
    const optionsForJob = jobCandidates(job);
    for (const draft of optionsForJob) {
      visited += 1;
      sessions.push(draft);
      if (search(position + 1)) return true;
      sessions.pop();
      if (visited >= nodeLimit) break;
    }
    return false;
  };
  const complete = search(0);
  if (!complete) sessions.splice(0, sessions.length, ...bestSessions);
  for (const batch of batchesSorted) {
    const requiredHours = weeklyHours(batch) || sessionDurations(batch).reduce((sum, minutes) => sum + minutes / 60, 0);
    const scheduledHours = sessions.filter((item) => item.batchDocId === batch.documentId).reduce((sum, item) => sum + Number(item.durationMinutes || item.endMinutes - item.startMinutes) / 60, 0);
    if (unscheduled.some((item) => item.batchDocId === batch.documentId)) continue;
    if (scheduledHours < requiredHours) {
      const modes = batch.learningModes || ['OFFLINE'];
      const rooms = getEligibleRooms(settings).filter((room) => Number(room.capacity) >= roomCapacityRequired(batch) && (!batch.roomType || room.type === batch.roomType));
      const days = (batch.availableDays || batch.permittedDays || settings.workingDays).map(normalizedDay);
      const assigned = trainers.find((item) => item.uid === batch.teacherId);
      const reason = !batch.teacherId ? 'Assign an approved trainer to this batch.'
        : !allowedDayCount(settings.workingDays, days) ? 'No institute working day is allowed for this batch.'
          : !rooms.length && !modes.includes('ONLINE') ? `No active room fits capacity ${batch.capacity}${batch.roomType ? ` and room type ${batch.roomType}` : ''}.`
            : assigned && !fitsAvailability(assigned.availability || assigned.teachingAvailability, settings.workingDays[0], toMinutes(settings.openTime), toMinutes(settings.openTime) + 60) ? 'Trainer availability does not overlap institute working hours.'
              : `Could not fit ${requiredHours - scheduledHours} remaining weekly hour(s) after searching ${visited} slot alternatives; review trainer, room, day and existing-session conflicts.`;
      unscheduled.push({ batchDocId: batch.documentId, name: batch.name, requiredHours, scheduledHours, unscheduledHours: Math.max(0, requiredHours - scheduledHours), reason });
    }
  }
  const report = eligibleBatches.map((batch) => {
    const requiredHours = weeklyHours(batch);
    const batchSessions = sessions.filter((session) => session.batchDocId === batch.documentId);
    const scheduledHours = batchSessions.reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes) / 60, 0);
    const issue = unscheduled.find((item) => item.batchDocId === batch.documentId);
    return { batchDocId: batch.documentId, batchName: batch.name, courseName: batch.courseName || batch.course || '', requiredHours: requiredHours || 0, scheduledHours, missingHours: Math.max(0, (requiredHours || 0) - scheduledHours), lectureCount: batchSessions.length, status: issue || !requiredHours || scheduledHours !== requiredHours ? (scheduledHours ? 'PARTIAL' : 'UNSCHEDULED') : 'COMPLETE', reason: issue?.reason || (!requiredHours ? 'Set a valid weekly teaching-hours requirement.' : scheduledHours > requiredHours ? 'Scheduled sessions exceed the weekly requirement; review manual sessions.' : '') };
  });
  const generatedSessions = sessions.filter((session) => session.source === 'GENERATED');
  const roomUtilization = getEligibleRooms(settings).map((room) => {
    const roomSessions = sessions.filter((session) => session.roomId === room.id);
    const occupiedMinutes = roomSessions.reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes), 0);
    const availability = room.availability || room;
    const roomDays = (availability.availableDays || availability.workingDays || settings.workingDays).map(normalizedDay);
    const availableMinutes = settings.workingDays.filter((day) => roomDays.includes(normalizedDay(day))).reduce((weeklyTotal, day) => {
      const dayAvailability = availability[normalizedDay(day)] || availability[String(normalizedDay(day)).toUpperCase()] || availability;
      const windows = Array.isArray(dayAvailability.windows) ? dayAvailability.windows : [{
        startTime: dayAvailability.availableStartTime || dayAvailability.startTime || settings.openTime,
        endTime: dayAvailability.availableEndTime || dayAvailability.endTime || settings.closeTime,
      }];
      const dayMinutes = windows.reduce((sum, window) => {
        const start = Math.max(toMinutes(settings.openTime), toMinutes(window.startTime || window.start));
        const end = Math.min(toMinutes(settings.closeTime), toMinutes(window.endTime || window.end));
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return sum;
        const breaksInWindow = settingsBreaks.reduce((breakMinutes, item) => breakMinutes + Math.max(0, Math.min(end, toMinutes(item.endTime)) - Math.max(start, toMinutes(item.startTime))), 0);
        return sum + Math.max(0, end - start - breaksInWindow);
      }, 0);
      return weeklyTotal + dayMinutes;
    }, 0);
    return { roomId: room.id, name: room.name, sessions: roomSessions.length, occupiedHours: occupiedMinutes / 60, availableHours: availableMinutes / 60, utilization: availableMinutes ? Math.round(occupiedMinutes / availableMinutes * 100) : 0 };
  });
  const trainerUtilization = [...new Set(eligibleBatches.map((batch) => batch.teacherId).filter(Boolean))].map((uid) => {
    const teacher = trainers.find((item) => item.uid === uid);
    const teaching = sessions.filter((session) => session.teacherId === uid);
    return { uid, name: teacher?.name || teacher?.email || teaching[0]?.teacherName || uid, sessions: teaching.length, occupiedHours: teaching.reduce((sum, item) => sum + Number(item.durationMinutes || item.endMinutes - item.startMinutes) / 60, 0) };
  });
  return { sessions, generatedSessions, unscheduled, eligibleCount: eligibleBatches.length, courseCount: new Set(eligibleBatches.map((batch) => batch.courseDocId).filter(Boolean)).size, trainerCount: trainerUtilization.length, roomCount: roomUtilization.length, visitedAlternatives: visited, complete: complete && unscheduled.length === 0, report, roomUtilization, trainerUtilization };
}

function allowedDayCount(instituteDays, batchDays) { return instituteDays.map(normalizedDay).filter((day) => batchDays.includes(day)).length; }
