import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, DoorOpen, Users } from 'lucide-react';
import { DAYS, getEligibleRooms, toTime } from './scheduler';

const dayKey = (value) => ({ MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' }[String(value || '').slice(0, 3).toUpperCase()] || value);
const displayTime = (minutes) => {
  const value = toTime(Number(minutes) || 0);
  const [hour, minute] = value.split(':').map(Number);
  return `${String(hour % 12 || 12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
};
const mondayOf = (date) => { const value = new Date(date); value.setHours(0, 0, 0, 0); value.setDate(value.getDate() - ((value.getDay() + 6) % 7)); return value; };
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export default function WeeklyTimetable({ profile, initialBatchId = '', batches = [], sessions = [], settings, roomById, conflicts = [], onEdit, onRemove, teachers = [] }) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [view, setView] = useState('week');
  const [batchFilter, setBatchFilter] = useState(initialBatchId);
  const [roomFilter, setRoomFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [dayFilter, setDayFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const owner = profile.role === 'OWNER';
  const rooms = useMemo(() => getEligibleRooms(settings), [settings]);
  const dayDates = useMemo(() => DAYS.map((_, index) => { const date = new Date(weekStart); date.setDate(date.getDate() + index); return date; }), [weekStart]);
  const batchesById = useMemo(() => new Map(batches.map((batch) => [batch.documentId, batch])), [batches]);
  const enrolledBatchIds = useMemo(() => new Set(batches.map((batch) => batch.documentId)), [batches]);
  const courses = useMemo(() => [...new Set(batches.map((batch) => batch.courseName || batch.course).filter(Boolean))].sort(), [batches]);
  const filtered = useMemo(() => sessions.filter((session) => {
    if (profile.role === 'STUDENT' && (!enrolledBatchIds.has(session.batchDocId) || session.status !== 'PUBLISHED')) return false;
    if (profile.role === 'TRAINER' && view !== 'all' && session.teacherId !== profile.uid) return false;
    if (batchFilter && session.batchDocId !== batchFilter) return false;
    if (roomFilter && session.roomId !== roomFilter) return false;
    if (teacherFilter && session.teacherId !== teacherFilter) return false;
    if (courseFilter && (batchesById.get(session.batchDocId)?.courseName || batchesById.get(session.batchDocId)?.course) !== courseFilter) return false;
    if (dayFilter && dayKey(session.day) !== dayFilter) return false;
    if (modeFilter && !(modeFilter === 'ONLINE' ? ['ONLINE', 'HYBRID'].includes(session.deliveryMode || (session.roomId === 'ONLINE' ? 'ONLINE' : 'OFFLINE')) : ['OFFLINE', 'HYBRID'].includes(session.deliveryMode || (session.roomId === 'ONLINE' ? 'ONLINE' : 'OFFLINE')))) return false;
    return true;
  }), [sessions, profile, enrolledBatchIds, view, batchFilter, roomFilter, teacherFilter, courseFilter, dayFilter, modeFilter, batchesById]);
  const weekSessions = filtered.filter((session) => {
    const dayIndex = DAYS.findIndex((day) => day.key === dayKey(session.day));
    if (dayIndex < 0) return false;
    const batch = batchesById.get(session.batchDocId);
    const scheduledDate = dateKey(dayDates[dayIndex]);
    return (!/^\d{4}-\d{2}-\d{2}$/.test(batch?.startDate || '') || scheduledDate >= batch.startDate)
      && (!/^\d{4}-\d{2}-\d{2}$/.test(batch?.endDate || '') || scheduledDate <= batch.endDate);
  });
  const visibleDays = DAYS.map((day, index) => ({ ...day, date: dayDates[index], holiday: (settings.holidays || []).includes(dateKey(dayDates[index])) }));
  const calendarRooms = [...rooms.filter((room) => !roomFilter || room.id === roomFilter), ...(weekSessions.some((session) => session.roomId === 'ONLINE') && (!roomFilter || roomFilter === 'ONLINE') ? [{ id: 'ONLINE', name: 'Online / Virtual', type: 'Virtual' }] : [])];
  const timelineStart = Number(settings.openTime.slice(0, 2)) * 60 + Number(settings.openTime.slice(3, 5));
  const timelineEnd = Number(settings.closeTime.slice(0, 2)) * 60 + Number(settings.closeTime.slice(3, 5));
  const gridDays = visibleDays.filter((day) => settings.workingDays.includes(day.key) && (!dayFilter || day.key === dayFilter));
  const gridBoundaries = new Set([timelineStart, timelineEnd]);
  for (let minute = timelineStart + Number(settings.slotIncrement); minute < timelineEnd; minute += Number(settings.slotIncrement)) gridBoundaries.add(minute);
  weekSessions.forEach((session) => { if (session.startMinutes >= timelineStart && session.endMinutes <= timelineEnd) { gridBoundaries.add(Number(session.startMinutes)); gridBoundaries.add(Number(session.endMinutes)); } });
  (settings.breaks || []).filter((item) => item.enabled).forEach((item) => { gridBoundaries.add(Number(item.startTime.slice(0, 2)) * 60 + Number(item.startTime.slice(3, 5))); gridBoundaries.add(Number(item.endTime.slice(0, 2)) * 60 + Number(item.endTime.slice(3, 5))); });
  const gridPoints = [...gridBoundaries].filter((minute) => minute >= timelineStart && minute <= timelineEnd).sort((a, b) => a - b);
  const gridIntervals = gridPoints.slice(0, -1).map((start, index) => ({ start, end: gridPoints[index + 1] }));
  const occupiedUntil = new Map();
  const canManage = owner;
  const teacherOptions = teachers.length ? teachers : [...new Map(sessions.filter((session) => session.teacherId).map((session) => [session.teacherId, { uid: session.teacherId, name: session.teacherName || session.teacherId }])).values()];
  const renderSession = (session) => {
    const batch = batchesById.get(session.batchDocId);
    const room = roomById.get(session.roomId);
    const isConflict = conflicts.some((item) => item.session.id === session.id);
    return <article key={session.id} className={`tt-slot${isConflict ? ' tt-slot--conflict' : ''}`}>
      <div className="tt-slot__top"><strong className="tt-slot__name">{session.batchName || batch?.name || 'Batch'}</strong>{canManage && <span className="tt-slot__actions"><button className="tt-weekgrid__edit" onClick={() => onEdit(session)}>Edit</button><button className="tt-weekgrid__edit" onClick={() => onRemove(session)}>Remove</button></span>}</div>
      <span className="tt-slot__course">{session.courseName || batch?.courseName || batch?.course || 'Course'}</span>
      <span className="tt-slot__time">{displayTime(session.startMinutes)}–{displayTime(session.endMinutes)}</span>
      <span className="tt-slot__teacher">{room?.name || session.roomName || (session.roomId === 'ONLINE' ? 'Online' : 'Room unavailable')} · {session.teacherName || batch?.teacherName || 'Trainer'}</span>
      <span className="tt-slot__mode">{session.deliveryMode || (session.roomId === 'ONLINE' ? 'ONLINE' : 'OFFLINE')}{session.deliveryMode === 'HYBRID' && session.onlineClassDetails ? ` · ${session.onlineClassDetails}` : ''}</span>
      <span className="tt-pill">{session.status || 'DRAFT'}</span>
    </article>;
  };
  const rangeLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const clearFilters = () => { setBatchFilter(''); setRoomFilter(''); setTeacherFilter(''); setCourseFilter(''); setDayFilter(''); setModeFilter(''); };
  const conflictSummary = [...new Map(conflicts.map((item) => {
    const key = `${item.session.batchDocId}:${item.message}`;
    return [key, { ...item, count: conflicts.filter((other) => other.session.batchDocId === item.session.batchDocId && other.message === item.message).length }];
  })).values()];
  const tabs = [{ id: 'week', text: 'Weekly' }, ...(owner ? [{ id: 'rooms', text: 'By room' }, { id: 'batches', text: 'By batch' }, { id: 'trainers', text: 'By trainer' }] : []), ...(profile.role === 'TRAINER' ? [{ id: 'all', text: 'All assigned staff sessions' }] : [])];

  return <section className="tt-card">
    <div className="tt-card__head"><div className="tt-card__titlewrap"><span className="tt-card__icon"><CalendarDays size={17}/></span><div><h2 className="tt-card__title">{profile.role === 'STUDENT' ? 'My weekly timetable' : 'Weekly schedule'}</h2><p className="tt-card__hint">Every concurrent class is listed independently with its room and trainer.</p></div></div></div>
    <div className="tt-toolbar">
      <div className="tt-viewswitch">{tabs.map((tab) => <button key={tab.id} className={`tt-viewswitch__btn${view === tab.id ? ' tt-viewswitch__btn--active' : ''}`} onClick={() => setView(tab.id)}>{tab.text}</button>)}</div>
      <label className="tt-filter"><span>Course</span><select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="">All courses</option>{courses.map((course) => <option key={course}>{course}</option>)}</select></label>
      <label className="tt-filter"><span>Day</span><select value={dayFilter} onChange={(event) => setDayFilter(event.target.value)}><option value="">All days</option>{DAYS.map((day) => <option key={day.key} value={day.key}>{day.label}</option>)}</select></label>
      <label className="tt-filter"><span>Delivery</span><select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}><option value="">All modes</option><option value="OFFLINE">In person</option><option value="ONLINE">Online</option></select></label>
      {profile.role !== 'STUDENT' && <label className="tt-filter"><span>Batch</span><select value={batchFilter} onChange={(event) => setBatchFilter(event.target.value)}><option value="">All batches</option>{batches.map((batch) => <option key={batch.documentId} value={batch.documentId}>{batch.name}</option>)}</select></label>}
      {owner && <><label className="tt-filter"><span>Room</span><select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}><option value="">All rooms</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}<option value="ONLINE">Online</option></select></label><label className="tt-filter"><span>Trainer</span><select value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)}><option value="">All trainers</option>{teacherOptions.map((teacher) => <option key={teacher.uid} value={teacher.uid}>{teacher.name || teacher.email || teacher.uid}</option>)}</select></label></>}
      {(batchFilter || roomFilter || teacherFilter || courseFilter || dayFilter || modeFilter) && <button className="tt-btn tt-btn--ghost" onClick={clearFilters}>Clear filters</button>}
    </div>
    {view !== 'batches' && <div className="tt-weeknav"><button className="tt-btn tt-btn--ghost" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 86400000))}><ChevronLeft size={15}/> Previous week</button><strong>{rangeLabel}</strong><button className="tt-btn tt-btn--ghost" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 86400000))}>Next week <ChevronRight size={15}/></button></div>}
    {view === 'week' && <>{conflictSummary.length > 0 && <div className="tt-conflicts" role="alert"><strong>Schedule conflicts</strong><ul>{conflictSummary.map((item) => <li key={`${item.session.batchDocId}-${item.message}`}>{item.session.batchName || batchesById.get(item.session.batchDocId)?.name || 'Batch'}: {item.message}{item.count > 1 ? ` (${item.count} sessions)` : ''}</li>)}</ul></div>}<div className="tt-grid-scroll"><table className="tt-weekgrid" style={{ minWidth: `${86 + gridDays.length * Math.max(1, calendarRooms.length) * 190}px` }}><colgroup><col style={{ width: 86 }}/>{gridDays.flatMap((day) => calendarRooms.length ? calendarRooms.map((room) => <col key={`${day.key}-${room.id}-column`} style={{ width: 190 }}/>) : [<col key={`${day.key}-empty-column`} style={{ width: 190 }}/>])}</colgroup><thead><tr><th rowSpan={2}>Day / Time</th>{gridDays.map((day) => <th key={day.key} colSpan={Math.max(1, calendarRooms.length)}>{day.label}<small>{day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></th>)}</tr><tr>{gridDays.flatMap((day) => calendarRooms.length ? calendarRooms.map((room) => <th key={`${day.key}-${room.id}`}>{room.name}<small>{room.type || (room.id === 'ONLINE' ? 'Virtual' : 'Room')}</small></th>) : [<th key={`${day.key}-empty`}>No eligible rooms</th>])}</tr></thead><tbody>{gridIntervals.map((interval, rowIndex) => {
      const cells = [];
      const lastRowInSpan = (end) => Math.max(rowIndex + 1, gridPoints.findIndex((point) => point === end));
      for (const day of gridDays) {
        if (!calendarRooms.length) { cells.push(<td key={`${day.key}-empty-${rowIndex}`} className="tt-weekgrid__empty"/>); continue; }
        for (const room of calendarRooms) {
          const columnKey = `${day.key}:${room.id}`;
          const daySessions = day.holiday ? [] : weekSessions.filter((session) => dayKey(session.day) === day.key && session.roomId === room.id && Number(session.startMinutes) === interval.start);
          const breakItem = (settings.breaks || []).find((item) => item.enabled && interval.start >= Number(item.startTime.slice(0, 2)) * 60 + Number(item.startTime.slice(3, 5)) && interval.end <= Number(item.endTime.slice(0, 2)) * 60 + Number(item.endTime.slice(3, 5)));
          const previousEnd = occupiedUntil.get(columnKey) || -1;
          if (rowIndex < previousEnd) continue;
          if (day.holiday && rowIndex === 0) {
            occupiedUntil.set(columnKey, gridIntervals.length);
            cells.push(<td key={`${columnKey}-holiday`} className="tt-weekgrid__closed" rowSpan={gridIntervals.length}>Holiday</td>);
            continue;
          }
          if (daySessions.length) {
            const end = Math.max(...daySessions.map((session) => Number(session.endMinutes)));
            const endRow = lastRowInSpan(end);
            const span = endRow - rowIndex;
            occupiedUntil.set(columnKey, endRow);
            const hasConflict = daySessions.some((session) => conflicts.some((item) => item.session.id === session.id));
            cells.push(<td key={`${columnKey}-${interval.start}`} rowSpan={span} className={`tt-weekgrid__event${hasConflict ? ' has-conflict' : ''}`} style={{ height: `${(end - interval.start) * 1}px` }}><div className="tt-weekgrid__events">{daySessions.map(renderSession)}</div></td>);
            continue;
          }
          if (breakItem) {
            const end = Number(breakItem.endTime.slice(0, 2)) * 60 + Number(breakItem.endTime.slice(3, 5));
            const endRow = lastRowInSpan(end);
            occupiedUntil.set(columnKey, endRow);
            cells.push(<td key={`${columnKey}-break-${interval.start}`} rowSpan={endRow - rowIndex} className="tt-weekgrid__break" style={{ height: `${(end - interval.start) * 1}px` }}>{breakItem.name || 'Break'}</td>);
            continue;
          }
          cells.push(<td key={`${columnKey}-empty-${interval.start}`} className="tt-weekgrid__empty"/>);
        }
      }
      return <tr key={interval.start} style={{ height: `${interval.end - interval.start}px` }}><th className="tt-weekgrid__time">{displayTime(interval.start)}</th>{cells}</tr>;
    })}</tbody></table>{!gridDays.length && <p className="tt-week-empty">Select a working day to view its timetable.</p>}</div></>}
    {view === 'rooms' && <div className="tt-roomview">{[...rooms, ...(weekSessions.some((session) => session.roomId === 'ONLINE') ? [{ id: 'ONLINE', name: 'Online', type: 'Virtual' }] : [])].filter((room) => !roomFilter || room.id === roomFilter).map((room) => <article className="tt-roomcard" key={room.id}><header><DoorOpen size={17}/><div><strong>{room.name}</strong><small>{room.type || 'Room'}{room.capacity ? ` · capacity ${room.capacity}` : ''}</small></div></header><div className="tt-roomcard__days">{visibleDays.filter((day) => settings.workingDays.includes(day.key)).map((day) => <section key={day.key}><h3>{day.label} <small>{day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></h3>{day.holiday ? <p className="tt-week-empty">Holiday</p> : <div className="tt-weekgrid__events">{weekSessions.filter((session) => session.roomId === room.id && dayKey(session.day) === day.key).sort((a, b) => a.startMinutes - b.startMinutes).map(renderSession)}{!weekSessions.some((session) => session.roomId === room.id && dayKey(session.day) === day.key) && <p className="tt-week-empty">No classes</p>}</div>}</section>)}</div></article>)}{!rooms.length && !weekSessions.some((session) => session.roomId === 'ONLINE') && <p className="tt-week-empty">No active rooms configured.</p>}</div>}
    {view === 'batches' && <div className="tt-batchview">{batches.filter((batch) => !batchFilter || batch.documentId === batchFilter).map((batch) => { const own = filtered.filter((session) => session.batchDocId === batch.documentId).sort((a, b) => DAYS.findIndex((day) => day.key === dayKey(a.day)) - DAYS.findIndex((day) => day.key === dayKey(b.day)) || a.startMinutes - b.startMinutes); const totalHours = own.reduce((sum, session) => sum + (Number(session.durationMinutes) || session.endMinutes - session.startMinutes) / 60, 0); return <article className="tt-batchcard" key={batch.documentId}><header className="tt-batchcard__head"><div><strong className="tt-batchcard__name">{batch.name}</strong><p className="tt-batchcard__meta">{batch.courseName || batch.course || 'Course'} · {batch.teacherName || batch.teacherId || 'Trainer'}</p></div><span className="tt-pill">{totalHours} h / week</span></header>{own.length ? <ul className="tt-batchcard__list">{own.map((session) => <li key={session.id}><span className="tt-batchcard__day">{DAYS.find((day) => day.key === dayKey(session.day))?.label}</span><span className="tt-batchcard__time">{displayTime(session.startMinutes)}–{displayTime(session.endMinutes)}</span><span className="tt-batchcard__room">{roomById.get(session.roomId)?.name || session.roomName || 'Online'}</span>{canManage && <button className="tt-weekgrid__edit" onClick={() => onEdit(session)}>Edit</button>}</li>)}</ul> : <p className="tt-batchcard__empty">No sessions scheduled.</p>}</article>; })}{!batches.length && <p className="tt-week-empty">No batches available.</p>}</div>}
    {view === 'trainers' && <div className="tt-roomview">{teacherOptions.filter((teacher) => !teacherFilter || teacher.uid === teacherFilter).map((teacher) => { const own = weekSessions.filter((session) => session.teacherId === teacher.uid).sort((a, b) => DAYS.findIndex((day) => day.key === dayKey(a.day)) - DAYS.findIndex((day) => day.key === dayKey(b.day)) || a.startMinutes - b.startMinutes); return <article className="tt-trainer-card" key={teacher.uid}><header><Users size={17}/><strong>{teacher.name || teacher.email || teacher.uid}</strong><span className="tt-pill">{own.length} sessions · {own.reduce((sum, session) => sum + (Number(session.durationMinutes) || session.endMinutes - session.startMinutes) / 60, 0)} h/week</span></header>{own.map(renderSession)}{!own.length && <p className="tt-week-empty">No sessions this week.</p>}</article>; })}</div>}
    {view === 'all' && <div className="tt-weekgrid__events">{filtered.map(renderSession)}{!filtered.length && <p className="tt-week-empty">No sessions match these filters.</p>}</div>}
    {view !== 'all' && view !== 'batches' && !weekSessions.length && <p className="tt-week-empty">No timetable sessions match this week and these filters.</p>}
    <p className="tt-week-footnote">{profile.role === 'STUDENT' ? 'Only published sessions for your active enrollments are shown.' : 'Sessions that start at the same time in different rooms remain visible as separate classes.'}</p>
  </section>;
}
