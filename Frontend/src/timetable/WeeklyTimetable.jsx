import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, DoorOpen, Grid3X3, Layers, RotateCcw, Users } from 'lucide-react';
import { DAYS, activeRooms, filterEligibleBatches, normalizeDay, overlaps, toMinutes, weeklyHours } from './scheduler';

const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const mondayOf = (date) => { const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result; };
const plusDays = (date, count) => { const result = new Date(date); result.setDate(result.getDate() + count); return result; };
const timeLabel = (minutes) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const round = (value, places = 1) => Math.round(value * (10 ** places)) / (10 ** places);
const EMPTY_FILTERS = { course: '', batch: '', teacher: '', room: '', day: '', mode: '' };
const sessionMinutes = (session) => Number(session.durationMinutes || session.endMinutes - session.startMinutes);

export default function WeeklyTimetable({ profile, initialBatchId = '', batches, sessions, settings, roomById, conflicts, onEdit, onRemove }) {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [view, setView] = useState('week');
  const [trainerView, setTrainerView] = useState('mine');
  const [selectedBatchId, setSelectedBatchId] = useState(initialBatchId);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const isStudent = profile.role === 'STUDENT';
  const isTrainer = profile.role === 'TRAINER';
  const isOwner = profile.role === 'OWNER';
  const enrolledBatches = isStudent ? batches : [];
  const chosenBatchId = isStudent ? (selectedBatchId || enrolledBatches[0]?.documentId || '') : '';
  const chosenBatch = batches.find((batch) => batch.documentId === chosenBatchId);

  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.documentId, batch])), [batches]);
  const conflictIds = useMemo(() => new Set(conflicts.map((item) => item.session.id)), [conflicts]);

  // Normalise weekday keys once so legacy (MON) and current (Mon) sessions render together.
  const allSessions = useMemo(() => sessions.map((session) => ({ ...session, day: normalizeDay(session.day) })), [sessions]);

  // Role scoping happens first, then the optional administrator/trainer filters.
  const scopedSessions = useMemo(() => allSessions.filter((session) => {
    if (isStudent && (session.batchDocId !== chosenBatchId || session.status !== 'PUBLISHED')) return false;
    if (isTrainer && trainerView === 'mine' && session.teacherId !== profile.uid) return false;
    return true;
  }), [allSessions, isStudent, isTrainer, trainerView, chosenBatchId, profile.uid]);

  const filteredSessions = useMemo(() => scopedSessions.filter((session) => {
    const batch = batchById.get(session.batchDocId);
    if (filters.batch && session.batchDocId !== filters.batch) return false;
    if (filters.course && (batch?.courseName || session.courseName) !== filters.course) return false;
    if (filters.teacher && session.teacherId !== filters.teacher) return false;
    if (filters.room && session.roomId !== filters.room) return false;
    if (filters.day && session.day !== filters.day) return false;
    if (filters.mode && (session.roomId === 'ONLINE' ? 'ONLINE' : 'OFFLINE') !== filters.mode) return false;
    return true;
  }), [scopedSessions, filters, batchById]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const resetFilters = () => setFilters(EMPTY_FILTERS);
  const setFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  const rooms = useMemo(() => activeRooms(settings), [settings]);

  const open = toMinutes(settings.openTime); const close = toMinutes(settings.closeTime); const step = Number(settings.slotIncrement) || 30;
  const slotCount = Number.isFinite(open) && Number.isFinite(close) && close > open ? Math.ceil((close - open) / step) : 0;
  const settingsDays = (settings.workingDays || []).map(normalizeDay);
  const breaks = (settings.breaks || []).filter((entry) => entry.enabled);

  const courseNames = useMemo(() => [...new Set(scopedSessions.map((session) => batchById.get(session.batchDocId)?.courseName || session.courseName).filter(Boolean))].sort(), [scopedSessions, batchById]);
  const trainerOptions = useMemo(() => [...new Map(scopedSessions.map((session) => [session.teacherId, session.teacherName || session.teacherId])).entries()].filter(([id]) => id), [scopedSessions]);
  const batchOptions = useMemo(() => [...new Map(scopedSessions.map((session) => [session.batchDocId, batchById.get(session.batchDocId)?.name || session.batchName || session.batchDocId])).entries()], [scopedSessions, batchById]);

  const activeChips = useMemo(() => {
    const labelFor = (key, value) => {
      if (key === 'batch') return batchById.get(value)?.name || value;
      if (key === 'teacher') return trainerOptions.find(([id]) => id === value)?.[1] || value;
      if (key === 'room') return value === 'ONLINE' ? 'Online' : roomById.get(value)?.name || value;
      if (key === 'day') return DAYS.find((day) => day.key === value)?.label || value;
      if (key === 'mode') return value === 'ONLINE' ? 'Online' : 'Offline';
      return value;
    };
    const titles = { course: 'Course', batch: 'Batch', room: 'Room', teacher: 'Trainer', day: 'Day', mode: 'Mode' };
    return Object.entries(filters).filter(([, value]) => value).map(([key, value]) => ({ key, label: titles[key] || key, value: labelFor(key, value) }));
  }, [filters, batchById, trainerOptions, roomById]);

  const weekDays = DAYS.map((day, index) => ({ ...day, date: plusDays(week, index), dateId: dateKey(plusDays(week, index)) }));
  const moveWeek = (amount) => setWeek((current) => plusDays(current, amount * 7));
  const weekLabel = `${weekDays[0].date.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekDays[6].date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const roomName = (id) => (id === 'ONLINE' ? 'Online' : roomById.get(id)?.name || 'Unassigned room');
  const sessionsForDay = (day, dateId) => filteredSessions.filter((session) => {
    const batch = batchById.get(session.batchDocId);
    return session.day === day && (!batch?.startDate || dateId >= batch.startDate) && (!batch?.endDate || dateId <= batch.endDate);
  });
  const sessionMeta = (session) => {
    const batch = batchById.get(session.batchDocId);
    return {
      title: batch?.name || session.batchName || 'Class',
      course: session.courseName || batch?.courseName || '',
      teacher: session.teacherName || batch?.teacherName || 'Trainer pending',
      room: roomName(session.roomId),
      duration: sessionMinutes(session),
      hasConflict: conflictIds.has(session.id),
    };
  };

  const viewTabs = [
    { key: 'week', label: 'Weekly', icon: CalendarDays },
    { key: 'room', label: 'Room-wise', icon: DoorOpen },
    { key: 'batch', label: 'Batch-wise', icon: Layers },
    { key: 'trainer', label: 'Trainer-wise', icon: Users },
  ];

  return <section className="tt-card tt-weekview">
    <div className="tt-card__head"><div className="tt-card__titlewrap"><span className="tt-card__icon"><CalendarDays size={17}/></span><div><h2 className="tt-card__title">{isStudent ? 'My class timetable' : 'Institute timetable'}</h2><p className="tt-card__hint">{isStudent ? 'Your published sessions for the selected batch.' : 'Saved sessions repeat on their assigned weekdays between each batch’s start and end dates. Use the filters to focus the view.'}</p></div></div></div>

    {isTrainer && <div className="tt-view-tabs" role="tablist" aria-label="Trainer timetable view"><button type="button" role="tab" aria-selected={trainerView === 'overall'} className={trainerView === 'overall' ? 'is-active' : ''} onClick={() => setTrainerView('overall')}>Overall institute timetable</button><button type="button" role="tab" aria-selected={trainerView === 'mine'} className={trainerView === 'mine' ? 'is-active' : ''} onClick={() => setTrainerView('mine')}>My lectures</button></div>}
    {isStudent && <div className="tt-student-batches">{enrolledBatches.length ? enrolledBatches.map((batch) => <button type="button" key={batch.documentId} className={`tt-student-batch${chosenBatchId === batch.documentId ? ' is-active' : ''}`} onClick={() => setSelectedBatchId(batch.documentId)}><span>{batch.courseName || batch.course || 'Course'}</span><strong>{batch.name}</strong><small>{batch.teacherName || 'Trainer to be assigned'}</small></button>) : <p className="tt-empty__text">No active batch enrollment was found for this account.</p>}</div>}

    {!isStudent && <div className="tt-viewswitch" role="tablist" aria-label="Timetable views">{viewTabs.map((tab) => { const Icon = tab.icon; return <button key={tab.key} type="button" role="tab" aria-selected={view === tab.key} className={`tt-viewswitch__btn${view === tab.key ? ' tt-viewswitch__btn--active' : ''}`} onClick={() => setView(tab.key)}><Icon size={14}/>{tab.label}</button>; })}</div>}

    {!isStudent && <div className="tt-filterbar">
      <div className="tt-filterbar__head">
        <span className="tt-filterbar__title"><Grid3X3 size={15}/> Filters{activeFilterCount > 0 && <em className="tt-filterbar__badge">{activeFilterCount}</em>}</span>
        <span className="tt-filterbar__count" role="status">Showing <strong>{filteredSessions.length}</strong> of <strong>{scopedSessions.length}</strong> session{scopedSessions.length === 1 ? '' : 's'}</span>
        <button type="button" className={`tt-btn tt-btn--ghost tt-btn--xs tt-filterbar__clear${activeFilterCount ? '' : ' is-hidden'}`} onClick={resetFilters}><RotateCcw size={13}/> Clear all</button>
      </div>
      <div className="tt-filterbar__grid">
        <label className="tt-filter"><span>Course</span><select value={filters.course} onChange={(event) => setFilter('course', event.target.value)}><option value="">All courses</option>{courseNames.map((course) => <option key={course} value={course}>{course}</option>)}</select></label>
        <label className="tt-filter"><span>Batch</span><select value={filters.batch} onChange={(event) => setFilter('batch', event.target.value)}><option value="">All batches</option>{batchOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="tt-filter"><span>Room</span><select value={filters.room} onChange={(event) => setFilter('room', event.target.value)}><option value="">All rooms</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}{scopedSessions.some((session) => session.roomId === 'ONLINE') && <option value="ONLINE">Online</option>}</select></label>
        <label className="tt-filter"><span>Trainer</span><select value={filters.teacher} onChange={(event) => setFilter('teacher', event.target.value)}><option value="">All trainers</option>{trainerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="tt-filter"><span>Day</span><select value={filters.day} onChange={(event) => setFilter('day', event.target.value)}><option value="">All days</option>{settingsDays.map((day) => <option key={day} value={day}>{DAYS.find((item) => item.key === day)?.label || day}</option>)}</select></label>
        <label className="tt-filter"><span>Mode</span><select value={filters.mode} onChange={(event) => setFilter('mode', event.target.value)}><option value="">All modes</option><option value="OFFLINE">Offline</option><option value="ONLINE">Online</option></select></label>
      </div>
      {activeFilterCount > 0 && <div className="tt-filterchips">{activeChips.map((chip) => <button type="button" key={chip.key} className="tt-filterchip" onClick={() => setFilter(chip.key, '')} aria-label={`Remove ${chip.label} filter`}><span>{chip.label}: {chip.value}</span><b aria-hidden="true">×</b></button>)}</div>}
    </div>}
    {!isStudent && activeFilterCount > 0 && !filteredSessions.length && <p className="tt-banner tt-banner--warn" role="status"><AlertTriangle size={15}/> No sessions match the active filters. <button type="button" className="tt-btn tt-btn--xs tt-btn--ghost" onClick={resetFilters}><RotateCcw size={12}/> Show everything</button></p>}

    {view === 'week' && <div className="tt-weeknav"><div><button className="tt-icon-btn" type="button" aria-label="Previous week" onClick={() => moveWeek(-1)}><ChevronLeft size={16}/></button><button className="tt-btn tt-btn--ghost" type="button" onClick={() => setWeek(mondayOf(new Date()))}>This week</button><button className="tt-icon-btn" type="button" aria-label="Next week" onClick={() => moveWeek(1)}><ChevronRight size={16}/></button></div><strong>{weekLabel}</strong></div>}

    {!filteredSessions.length && <p className="tt-week-empty">{isStudent && chosenBatch ? `No published sessions are scheduled for ${chosenBatch.name} in the selected week.` : activeFilterCount ? 'No saved timetable sessions match the active filters.' : 'No saved timetable sessions match this view.'}</p>}

    {view === 'week' && slotCount > 0 && <WeekGrid {...{ open, close, step, slotCount, weekDays, settingsDays, breaks, filteredSessions, sessionsForDay, sessionMeta, timeLabel, isOwner, onEdit, onRemove }}/>}

    {view === 'room' && <RoomView {...{ rooms, filteredSessions, open, close, step, slotCount, weekDays, settingsDays, sessionsForDay, sessionMeta, timeLabel, isOwner, onEdit, onRemove }}/>}

    {view === 'batch' && <BatchView {...{ batches, filteredSessions, sessionMeta, timeLabel, isOwner, onEdit, onRemove }}/>}

    {view === 'trainer' && <TrainerView {...{ filteredSessions, batchById, sessionMeta, timeLabel, isOwner, onEdit, onRemove }}/>}

    {isStudent && chosenBatch && <p className="tt-week-footnote">{chosenBatch.courseName || chosenBatch.course} · {chosenBatch.name} · {chosenBatch.teacherName || 'Trainer pending'} · {chosenBatch.startDate || 'Start date pending'} to {chosenBatch.endDate || 'End date pending'}</p>}
  </section>;
}

function SessionActions({ session, isOwner, onEdit, onRemove }) {
  if (!isOwner) return null;
  return <span className="tt-slot__actions"><button type="button" className="tt-weekgrid__edit" onClick={() => onEdit(session)}>Edit</button>{session.status !== 'PUBLISHED' && <button type="button" className="tt-weekgrid__edit" onClick={() => onRemove(session)}>Remove</button>}</span>;
}

function WeekGrid({ open, close, step, slotCount, weekDays, settingsDays, breaks, filteredSessions, sessionsForDay, sessionMeta, timeLabel, isOwner, onEdit, onRemove }) {
  const occupied = new Set();
  const rows = Array.from({ length: slotCount }, (_, row) => {
    const start = open + row * step;
    const end = Math.min(close, start + step);
    const cells = weekDays.map((day) => {
      if (!settingsDays.includes(day.key)) return <td key={day.key} className="tt-weekgrid__closed">Closed</td>;
      if (occupied.has(`${day.key}-${row}`)) return null;
      const daySessions = sessionsForDay(day.key, day.dateId);
      const starting = daySessions.filter((session) => session.startMinutes >= start && session.startMinutes < end);
      if (starting.length) {
        const lastEnd = Math.max(...starting.map((session) => session.endMinutes));
        const span = Math.max(1, Math.min(slotCount - row, Math.ceil((lastEnd - start) / step)));
        for (let next = row + 1; next < Math.min(slotCount, row + span); next += 1) occupied.add(`${day.key}-${next}`);
        const anyConflict = starting.some((session) => sessionMeta(session).hasConflict);
        return <td key={day.key} rowSpan={span} className={`tt-weekgrid__event${anyConflict ? ' has-conflict' : ''}`}>{starting.map((session) => { const meta = sessionMeta(session); return <article key={session.id}><div className="tt-slot__top"><strong>{meta.title}</strong><SessionActions session={session} isOwner={isOwner} onEdit={onEdit} onRemove={onRemove}/></div><span>{meta.course}</span><small>{timeLabel(session.startMinutes)}–{timeLabel(session.endMinutes)}</small><small>{meta.teacher} · {meta.room}</small><em>{session.needsReview ? 'NEEDS REVIEW' : session.status || 'DRAFT'} · {round(meta.duration / 60)} h</em></article>; })}</td>;
      }
      const pause = breaks.find((entry) => toMinutes(entry.startTime) < end && toMinutes(entry.endTime) > start);
      if (pause) return <td key={day.key} className="tt-weekgrid__break">{row === Math.floor((toMinutes(pause.startTime) - open) / step) ? pause.name : ''}</td>;
      return <td key={day.key} className="tt-weekgrid__empty"/>;
    });
    return <tr key={start}><th className="tt-weekgrid__time">{timeLabel(start)}<small>{timeLabel(end)}</small></th>{cells}</tr>;
  });
  return <div className="tt-grid-scroll"><table className="tt-weekgrid"><thead><tr><th>Time</th>{weekDays.map((day) => <th key={day.key}><span>{day.label}</span><small>{day.date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></th>)}</tr></thead><tbody>{rows}</tbody></table></div>;
}

function RoomView({ rooms, filteredSessions, open, close, step, slotCount, weekDays, settingsDays, sessionsForDay, sessionMeta, timeLabel, isOwner, onEdit, onRemove }) {
  const onlineUsed = filteredSessions.some((session) => session.roomId === 'ONLINE');
  const columns = [...rooms.map((room) => ({ id: room.id, name: room.name, type: room.type || 'Classroom' })), ...(onlineUsed ? [{ id: 'ONLINE', name: 'Online', type: 'Virtual' }] : [])];
  if (!columns.length) return <div className="tt-empty"><DoorOpen size={24}/><p className="tt-empty__title">No rooms configured</p><p className="tt-empty__text">Add rooms in the timetable settings to schedule offline classes.</p></div>;
  const usage = (roomId) => filteredSessions.filter((session) => session.roomId === roomId);
  const occupied = new Set();
  const rows = weekDays.flatMap((day) => Array.from({ length: slotCount }, (_, row) => {
    const start = open + row * step;
    const end = Math.min(close, start + step);
    const dayKey = `${day.key}-${row}`;
    if (!settingsDays.includes(day.key)) return <tr className="tt-grid__closed-row" key={dayKey}><th className="tt-grid__time"><span className="tt-grid__time-main">{day.label}</span><span className="tt-grid__time-sub">{timeLabel(start)}</span></th><td colSpan={columns.length} className="tt-grid__closed-cell">Institute closed</td></tr>;
    const daySessions = sessionsForDay(day.key, day.dateId);
    return <tr key={dayKey}><th className="tt-grid__time"><span className="tt-grid__time-main">{day.label} · {timeLabel(start)}</span><span className="tt-grid__time-sub">{day.date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · to {timeLabel(end)}</span></th>{columns.map((room) => {
      if (occupied.has(`${day.key}-${room.id}-${row}`)) return null;
      const cellSessions = daySessions.filter((session) => session.roomId === room.id && session.startMinutes >= start && session.startMinutes < end);
      if (!cellSessions.length) return <td key={room.id} className="tt-grid__cell"><span className="tt-grid__free">Free</span></td>;
      const lastEnd = Math.max(...cellSessions.map((session) => session.endMinutes));
      const span = Math.max(1, Math.min(slotCount - row, Math.ceil((lastEnd - start) / step)));
      for (let next = row + 1; next < row + span; next += 1) occupied.add(`${day.key}-${room.id}-${next}`);
      return <td key={room.id} rowSpan={span} className="tt-grid__cell tt-grid__cell--occupied">{cellSessions.map((session) => { const meta = sessionMeta(session); return <article key={session.id} className={`tt-slot${meta.hasConflict ? ' tt-slot--conflict' : ''}`}><div className="tt-slot__top"><span className="tt-slot__name">{meta.title}</span><SessionActions session={session} isOwner={isOwner} onEdit={onEdit} onRemove={onRemove}/></div><span className="tt-slot__course">{meta.course}</span><span className="tt-slot__time">{timeLabel(session.startMinutes)}–{timeLabel(session.endMinutes)}</span><span className="tt-slot__teacher">{meta.teacher}</span>{meta.hasConflict && <span className="tt-slot__flag"><AlertTriangle size={11}/> Conflict</span>}</article>; })}</td>;
    })}</tr>;
  }));
  return <div className="tt-grid-wrap"><table className="tt-grid"><thead><tr><th className="tt-grid__corner">Day / time</th>{columns.map((room) => { const list = usage(room.id); const occupiedMinutes = list.reduce((sum, session) => sum + sessionMinutes(session), 0); return <th key={room.id}><span>{room.name}</span><span className="tt-grid__roomtype">{room.type} · {list.length} session(s) · {round(occupiedMinutes / 60)} h</span></th>; })}</tr></thead><tbody>{rows}</tbody></table></div>;
}

function BatchView({ batches, filteredSessions, sessionMeta, timeLabel, isOwner, onEdit, onRemove }) {
  const active = filterEligibleBatches(batches);
  if (!active.length) return <p className="tt-week-empty">No active batches are available for this view.</p>;
  return <div className="tt-batchview">{active.map((batch) => {
    const required = weeklyHours(batch);
    const list = filteredSessions.filter((session) => session.batchDocId === batch.documentId).sort((a, b) => DAYS.findIndex((day) => day.key === a.day) - DAYS.findIndex((day) => day.key === b.day) || a.startMinutes - b.startMinutes);
    const scheduledMinutes = list.reduce((sum, session) => sum + sessionMinutes(session), 0);
    const scheduled = round(scheduledMinutes / 60);
    const missing = required ? round(Math.max(0, required - scheduled)) : 0;
    const complete = required && scheduled >= required;
    return <article className="tt-batchcard" key={batch.documentId}><div className="tt-batchcard__head"><div><p className="tt-batchcard__name">{batch.name}</p><p className="tt-batchcard__meta">{batch.courseName || batch.course || 'Course not linked'} · {batch.teacherName || batch.teacherId || 'Trainer pending'}</p></div><span className={`tt-pill ${complete ? 'tt-pill--good' : missing || !required ? 'tt-pill--warn' : 'tt-pill--bad'}`}>{required ? `${scheduled} / ${required} h` : 'Hours not set'}</span></div>{list.length ? <ul className="tt-batchcard__list">{list.map((session) => { const meta = sessionMeta(session); return <li key={session.id}><span className="tt-batchcard__day">{session.day}</span><span className="tt-batchcard__time">{timeLabel(session.startMinutes)}–{timeLabel(session.endMinutes)}</span><span className="tt-batchcard__room"><DoorOpen size={12}/>{meta.room} · {meta.teacher}</span><SessionActions session={session} isOwner={isOwner} onEdit={onEdit} onRemove={onRemove}/></li>; })}</ul> : <p className="tt-batchcard__empty">No sessions scheduled for this batch yet.</p>}{required ? <p className="tt-batchcard__meta">{complete ? 'Weekly requirement fully scheduled.' : `${missing} h of ${required} h still unscheduled.`}</p> : null}</article>;
  })}</div>;
}

function TrainerView({ filteredSessions, batchById, sessionMeta, timeLabel, isOwner, onEdit, onRemove }) {
  const groups = new Map();
  for (const session of filteredSessions) {
    const key = session.teacherId || 'unassigned';
    if (!groups.has(key)) groups.set(key, { name: session.teacherName || session.teacherId || 'Unassigned trainer', sessions: [] });
    groups.get(key).sessions.push(session);
  }
  if (!groups.size) return <p className="tt-week-empty">No trainer sessions match this view.</p>;
  return <div className="tt-batchview">{[...groups.entries()].map(([id, group]) => {
    const list = [...group.sessions].sort((a, b) => DAYS.findIndex((day) => day.key === a.day) - DAYS.findIndex((day) => day.key === b.day) || a.startMinutes - b.startMinutes);
    const conflict = list.some((a, index) => list.slice(index + 1).some((b) => a.day === b.day && overlaps(a.startMinutes, a.endMinutes, b.startMinutes, b.endMinutes)));
    const totalHours = round(list.reduce((sum, session) => sum + sessionMinutes(session), 0) / 60);
    return <article className="tt-batchcard" key={id}><div className="tt-batchcard__head"><div><p className="tt-batchcard__name">{group.name}</p><p className="tt-batchcard__meta">{list.length} session(s) · {totalHours} h/week</p></div>{conflict ? <span className="tt-pill tt-pill--bad">Conflict</span> : <span className="tt-pill tt-pill--good">Clear</span>}</div><ul className="tt-batchcard__list">{list.map((session) => { const meta = sessionMeta(session); return <li key={session.id}><span className="tt-batchcard__day">{session.day}</span><span className="tt-batchcard__time">{timeLabel(session.startMinutes)}–{timeLabel(session.endMinutes)}</span><span className="tt-batchcard__room"><DoorOpen size={12}/>{meta.room} · {batchById.get(session.batchDocId)?.name || session.batchName}</span><SessionActions session={session} isOwner={isOwner} onEdit={onEdit} onRemove={onRemove}/></li>; })}</ul></article>;
  })}</div>;
}
