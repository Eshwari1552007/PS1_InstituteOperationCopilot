import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, Check, Clock3, DoorOpen, Loader, Plus, RefreshCw, Save, Sparkles, Trash, Users } from 'lucide-react';
import { DEFAULT_SETTINGS, DAYS, durationMinutes, generateSchedule, sessionConflicts, toMinutes, toTime, validateSettings, weeklySessions } from './scheduler';
import { deleteTimetableDraft, loadTimetableWorkspace, persistTimetable, publishTimetable } from './timetableService';
import { saveBatch } from '../batches/academyService';
import './Timetable.css';

const timeLabel = (minutes) => new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayTitle = (key) => DAYS.find((day) => day.key === key)?.label || key;
const preferredDaysText = (batch) => (batch.daysOfWeek || []).map((code) => dayTitle(({ MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' }[code] || code)).slice(0, 3)).join(', ') || 'Any working day';
const defaultBreak = () => ({ id: `break-${Date.now()}`, name: 'Break', enabled: true, startTime: '11:00', endTime: '11:15' });

export default function Timetable({ profile }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [batches, setBatches] = useState([]); const [sessions, setSessions] = useState([]); const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [dirtySettings, setDirtySettings] = useState(false); const [editing, setEditing] = useState(null); const [editorErrors, setEditorErrors] = useState([]);
  const owner = profile.role === 'OWNER';

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const workspace = await loadTimetableWorkspace(profile);
      setSettings(workspace.settings); setBatches(workspace.batches); setSessions(workspace.sessions); setTeachers(workspace.teachers); setDirtySettings(false);
    } catch (failure) { setError(failure.code === 'permission-denied' ? 'Firestore denied timetable access. Owners manage schedules; trainers can view their assigned classes. Confirm the current security rules are deployed.' : failure.message); }
    finally { setLoading(false); }
  }, [profile]);
  useEffect(() => { refresh(); }, [refresh]);

  const issues = useMemo(() => validateSettings(settings), [settings]);
  const conflicts = useMemo(() => sessions.flatMap((session) => sessionConflicts(session, sessions, batches, settings, session.id).map((message) => ({ id: `${session.id}-${message}`, session, message }))), [sessions, batches, settings]);
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.documentId, batch])), [batches]);
  const roomById = useMemo(() => new Map((settings.rooms || []).map((room) => [room.id, room])), [settings.rooms]);
  const scheduledCountByBatch = useMemo(() => sessions.reduce((map, session) => map.set(session.batchDocId, (map.get(session.batchDocId) || 0) + 1), new Map()), [sessions]);
  const activeBatches = batches.filter((batch) => !batch.isArchived && !batch.isClosed && !['INACTIVE', 'CLOSED', 'COMPLETED'].includes(batch.status));
  const unscheduled = activeBatches.flatMap((batch) => {
    const required = weeklySessions(batch); const placed = scheduledCountByBatch.get(batch.documentId) || 0;
    if (placed >= required) return [];
    const duration = durationMinutes(batch);
    return [{ batch, placed, required, reason: !duration ? 'Missing required class duration. Edit this legacy batch and set its duration.' : !settings.rooms.length && (batch.learningModes || ['OFFLINE']).includes('OFFLINE') ? 'Configure at least one room with enough capacity.' : `${placed} of ${required} weekly sessions scheduled; resolve the remaining time, teacher, room, or batch conflicts.` }];
  });
  const status = sessions.some((session) => session.status === 'PUBLISHED') ? 'Published' : sessions.length ? 'Draft' : 'Not generated';

  const updateSettings = (patch) => { setSettings((current) => ({ ...current, ...patch })); setDirtySettings(true); setNotice(''); };
  const updateRoom = (id, patch) => updateSettings({ rooms: settings.rooms.map((room) => room.id === id ? { ...room, ...patch } : room) });
  const addRoom = () => updateSettings({ rooms: [...settings.rooms, { id: `room-${Date.now()}`, name: `Room ${settings.rooms.length + 1}`, type: 'Classroom', capacity: 30 }] });
  const removeRoom = (id) => updateSettings({ rooms: settings.rooms.filter((room) => room.id !== id) });
  const updateBreak = (id, patch) => updateSettings({ breaks: settings.breaks.map((item) => item.id === id ? { ...item, ...patch } : item) });

  const save = async (nextSessions = sessions, nextSettings = settings) => {
    setBusy(true); setError(''); setNotice('');
    try { await persistTimetable(nextSettings, nextSessions, sessions); setSessions(nextSessions); setSettings(nextSettings); setDirtySettings(false); setNotice('Timetable changes saved to Firestore.'); }
    catch (failure) { setError(failure.code === 'permission-denied' ? 'Only an approved Owner can save timetable changes. Confirm the Owner account is active.' : `Could not save timetable: ${failure.message}`); throw failure; }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (issues.length) return setError(issues.join(' '));
    if (dirtySettings) { setError('Save the scheduling settings first, then generate.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = generateSchedule(settings, activeBatches, sessions);
      await persistTimetable(settings, result.sessions, sessions);
      setSessions(result.sessions);
      setNotice(result.unscheduled.length ? `Generated and saved ${result.sessions.length} class session(s). ${result.unscheduled.length} batch(es) still need a slot; see the reasons below.` : `Generated and saved ${result.sessions.length} weekly class session(s).`);
    } catch (failure) { setError(failure.code === 'permission-denied' ? 'Only an approved Owner can generate and save the timetable.' : `Timetable generation could not be saved: ${failure.message}`); }
    finally { setBusy(false); }
  };
  const openEditor = (session = null, batch = null) => {
    const target = batch || batchById.get(session?.batchDocId);
    const room = settings.rooms.find((item) => item.id === session?.roomId) || settings.rooms[0];
    const duration = session ? session.endMinutes - session.startMinutes : durationMinutes(target);
    const firstDay = settings.workingDays.find((day) => !(target?.daysOfWeek || []).length || target.daysOfWeek.some((d) => ({ MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' }[d] || d) === day)) || settings.workingDays[0] || 'Mon';
    const start = session?.startMinutes ?? toMinutes(settings.openTime);
    const onlineOnly = target && !(target.learningModes || ['OFFLINE']).includes('OFFLINE');
    setEditing({ id: session?.id || `${target.documentId}__manual-${Date.now()}`, batchDocId: target?.documentId || '', day: session?.day || firstDay, startMinutes: start, endMinutes: start + (duration || 0), durationMinutes: duration || 0, roomId: session?.roomId || (onlineOnly ? 'ONLINE' : room?.id || ''), teacherId: session?.teacherId || target?.teacherId || '', source: session?.source || 'MANUAL', status: 'DRAFT', sessionIndex: session?.sessionIndex || (scheduledCountByBatch.get(target?.documentId) || 0) + 1 });
    setEditorErrors([]);
  };
  const updateEditor = (patch) => setEditing((current) => {
    if (!current) return current;
    const next = { ...current, ...patch };
    if ('startMinutes' in patch) next.endMinutes = Number(patch.startMinutes) + current.durationMinutes;
    return next;
  });
  const saveEditor = async () => {
    const errors = sessionConflicts(editing, sessions, batches, settings, editing.id);
    if (errors.length) return setEditorErrors(errors);
    const batch = batchById.get(editing.batchDocId); const room = roomById.get(editing.roomId);
    const teacher = teachers.find((item) => item.uid === editing.teacherId);
    const changedTeacher = editing.teacherId !== batch.teacherId;
    const nextBatch = changedTeacher ? { ...batch, teacherId: editing.teacherId, teacherName: teacher?.name || teacher?.email || batch.teacherName } : batch;
    const next = { ...editing, batchId: batch.batchId, batchName: batch.name, courseName: batch.courseName || batch.course, roomName: room?.name || 'Online', teacherName: nextBatch.teacherName || '', source: 'MANUAL', updatedBy: profile.uid };
    const nextSessions = [...sessions.filter((session) => session.id !== editing.id).map((session) => session.batchDocId === batch.documentId && changedTeacher ? { ...session, teacherId: nextBatch.teacherId, teacherName: nextBatch.teacherName } : session), next].sort((a, b) => DAYS.findIndex((day) => day.key === a.day) - DAYS.findIndex((day) => day.key === b.day) || a.startMinutes - b.startMinutes);
    try {
      if (changedTeacher) { await saveBatch({ ...nextBatch, sessionsPerWeek: batch.sessionsPerWeek || weeklySessions(batch) }, profile.uid, batch.documentId); setBatches((current) => current.map((item) => item.documentId === batch.documentId ? nextBatch : item)); }
      await save(nextSessions); setEditing(null);
    } catch { /* error is displayed above the editor */ }
  };
  const remove = async (session) => {
    if (session.status === 'PUBLISHED') return setError('This session is published. Unpublish it before removing or rescheduling.');
    setBusy(true); setError('');
    try { await deleteTimetableDraft(session); const next = sessions.filter((item) => item.id !== session.id); setSessions(next); setNotice('Draft session removed.'); }
    catch (failure) { setError(`Could not remove the session: ${failure.message}`); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!sessions.length || unscheduled.length || conflicts.length || issues.length || dirtySettings) return setError('Save valid settings, resolve all schedule conflicts, and schedule every active batch before publishing.');
    setBusy(true); setError('');
    try { await publishTimetable(sessions.filter((item) => item.status !== 'PUBLISHED')); const published = sessions.map((item) => ({ ...item, status: 'PUBLISHED' })); setSessions(published); setNotice('Timetable published.'); }
    catch (failure) { setError(`Could not publish timetable: ${failure.message}`); }
    finally { setBusy(false); }
  };

  const visibleSessions = (settings.workingDays || []).flatMap((day) => sessions.filter((session) => session.day === day).sort((a, b) => a.startMinutes - b.startMinutes));
  return <div className="tt-root">
    <header className="tt-header"><div className="tt-header__text"><p className="tt-header__eyebrow">EDUPILOT · ACADEMICS</p><h1 className="tt-header__title">Timetable Management</h1><p className="tt-header__subtitle">Configure institute hours, then schedule actual batches using each class’s required duration.</p></div><div className="tt-header__actions"><span className={`tt-state tt-state--${status.toLowerCase().replace(' ', '-')}`}>{status}</span><button className="tt-btn tt-btn--ghost" onClick={refresh} disabled={loading || busy}><RefreshCw size={15}/> Refresh</button>{owner && <><button className="tt-btn tt-btn--primary" onClick={generate} disabled={busy || loading}><Sparkles size={15}/>{busy ? 'Working…' : 'Generate timetable'}</button><button className="tt-btn" onClick={publish} disabled={busy || !sessions.length}>Publish</button></>}</div></header>
    {error && <p className="tt-banner tt-banner--warn" role="alert"><AlertCircle size={16}/>{error}</p>}{notice && <p className="tt-banner tt-banner--ok" role="status"><Check size={16}/>{notice}</p>}
    {loading ? <div className="tt-empty"><Loader className="tt-spin"/><p className="tt-empty__title">Loading Firestore timetable…</p></div> : <>
      <section className="tt-summaries" aria-label="Timetable statistics"><article className="tt-summary"><span className="tt-summary__icon"><DoorOpen size={18}/></span><div><p className="tt-summary__label">Rooms configured</p><p className="tt-summary__value">{settings.rooms.length}</p></div></article><article className="tt-summary"><span className="tt-summary__icon"><Users size={18}/></span><div><p className="tt-summary__label">Active batches</p><p className="tt-summary__value">{activeBatches.length}</p></div></article><article className="tt-summary"><span className="tt-summary__icon"><CalendarDays size={18}/></span><div><p className="tt-summary__label">Weekly sessions</p><p className="tt-summary__value">{sessions.length}</p></div></article><article className="tt-summary"><span className="tt-summary__icon"><AlertCircle size={18}/></span><div><p className="tt-summary__label">Unscheduled batches</p><p className="tt-summary__value">{unscheduled.length}</p></div></article></section>
      {owner && <section className="tt-card"><div className="tt-card__head"><div className="tt-card__titlewrap"><span className="tt-card__icon"><CalendarDays size={17}/></span><div><h2 className="tt-card__title">Institute scheduling settings</h2><p className="tt-card__hint">These settings and rooms are stored with the timetable. Old batch clock times are preserved as legacy values.</p></div></div>{dirtySettings && <span className="tt-pill tt-pill--warn">Unsaved settings</span>}</div>
        <div className="tt-form-grid"><label className="tt-field"><span className="tt-field__label">Opening time</span><input type="time" value={settings.openTime} onChange={(event) => updateSettings({ openTime: event.target.value })}/></label><label className="tt-field"><span className="tt-field__label">Closing time</span><input type="time" value={settings.closeTime} onChange={(event) => updateSettings({ closeTime: event.target.value })}/></label><label className="tt-field"><span className="tt-field__label">Slot increment</span><select value={settings.slotIncrement} onChange={(event) => updateSettings({ slotIncrement: Number(event.target.value) })}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label></div>
        <fieldset className="tt-fieldset"><legend className="tt-fieldset__legend">Working days</legend><div className="tt-days">{DAYS.map((day) => <label className={`tt-day${settings.workingDays.includes(day.key) ? ' tt-day--active' : ''}`} key={day.key}><input type="checkbox" checked={settings.workingDays.includes(day.key)} onChange={() => updateSettings({ workingDays: settings.workingDays.includes(day.key) ? settings.workingDays.filter((item) => item !== day.key) : DAYS.filter((item) => item.key === day.key || settings.workingDays.includes(item.key)).map((item) => item.key) })}/>{day.label}</label>)}</div></fieldset>
        <div className="tt-breaks">{settings.breaks.map((item) => <div className="tt-break" key={item.id}><label className="tt-switch"><input type="checkbox" checked={item.enabled} onChange={(event) => updateBreak(item.id, { enabled: event.target.checked })}/><span>{item.name}</span></label><div className="tt-break__times"><input aria-label={`${item.name} starts`} type="time" value={item.startTime} disabled={!item.enabled} onChange={(event) => updateBreak(item.id, { startTime: event.target.value })}/><span className="tt-break__dash">to</span><input aria-label={`${item.name} ends`} type="time" value={item.endTime} disabled={!item.enabled} onChange={(event) => updateBreak(item.id, { endTime: event.target.value })}/></div><button className="tt-icon-btn tt-icon-btn--danger" aria-label={`Remove ${item.name}`} onClick={() => updateSettings({ breaks: settings.breaks.filter((entry) => entry.id !== item.id) })}><Trash size={14}/></button></div>)}</div><button className="tt-btn tt-btn--ghost" onClick={() => updateSettings({ breaks: [...settings.breaks, defaultBreak()] })}><Plus size={14}/> Add break</button>
        <div className="tt-rooms"><div className="tt-rooms__head"><div><h3 className="tt-card__title">Available rooms</h3><p className="tt-card__hint">Room capacity must accommodate the batch’s maximum enrollment.</p></div><button className="tt-btn tt-btn--ghost" onClick={addRoom}><Plus size={14}/> Add room</button></div><ul className="tt-room-list">{settings.rooms.map((room) => <li className="tt-room" key={room.id}><input aria-label="Room name" value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })}/><select aria-label={`Room type for ${room.name}`} value={room.type} onChange={(event) => updateRoom(room.id, { type: event.target.value })}><option>Classroom</option><option>Lab</option></select><input aria-label={`Capacity for ${room.name}`} type="number" min="1" value={room.capacity} onChange={(event) => updateRoom(room.id, { capacity: Number(event.target.value) })}/><button className="tt-icon-btn tt-icon-btn--danger" aria-label={`Remove ${room.name}`} onClick={() => removeRoom(room.id)}><Trash size={14}/></button></li>)}{!settings.rooms.length && <li className="tt-room tt-room--empty">No rooms configured. Add rooms before scheduling offline batches.</li>}</ul></div>
        {issues.length > 0 && <ul className="tt-form-errors">{issues.map((item) => <li key={item}><AlertCircle size={14}/>{item}</li>)}</ul>}
        <footer className="tt-actions"><span className="tt-actions__note">Changes are stored in Firestore, not local browser state.</span><button className="tt-btn tt-btn--primary" disabled={busy || issues.length > 0 || !dirtySettings} onClick={() => save(sessions)}><Save size={15}/>{busy ? 'Saving…' : 'Save settings'}</button></footer>
      </section>}
      <section className="tt-card"><div className="tt-card__head"><div className="tt-card__titlewrap"><span className="tt-card__icon"><Users size={17}/></span><div><h2 className="tt-card__title">Available batches</h2><p className="tt-card__hint">Real batches from Batch Management. Session length is read from Required class duration.</p></div></div></div>{activeBatches.length ? <div className="tt-table-wrap"><table className="tt-table"><thead><tr><th>Batch</th><th>Course</th><th>Trainer</th><th>Class duration</th><th>Sessions / week</th><th>Preferred days</th><th>Scheduled</th>{owner && <th>Action</th>}</tr></thead><tbody>{activeBatches.map((batch) => { const duration = durationMinutes(batch); const count = scheduledCountByBatch.get(batch.documentId) || 0; return <tr key={batch.documentId}><td><span className="tt-batch"><span className="tt-batch__id">{batch.batchId}</span><span className="tt-batch__name">{batch.name}</span></span></td><td>{batch.courseName || batch.course || '—'}</td><td>{batch.teacherName || batch.teacherId || '—'}</td><td>{duration ? `${(duration / 60).toLocaleString()} h${batch.durationHours ? '' : ' · legacy'}` : <span className="tt-pill tt-pill--warn">Set duration</span>}</td><td>{weeklySessions(batch)}</td><td>{preferredDaysText(batch)}</td><td>{count}/{weeklySessions(batch)}</td>{owner && <td><button className="tt-btn tt-btn--xs tt-btn--ghost" disabled={!duration || !settings.workingDays.length || busy} onClick={() => openEditor(null, batch)}>Assign slot</button></td>}</tr>; })}</tbody></table></div> : <div className="tt-empty"><Users size={24}/><p className="tt-empty__title">No active batches found</p><p className="tt-empty__text">Create batches in Batches &amp; Courses. They will appear here automatically.</p></div>}</section>
      <section className="tt-card"><div className="tt-card__head"><div className="tt-card__titlewrap"><span className="tt-card__icon"><Clock3 size={17}/></span><div><h2 className="tt-card__title">Weekly schedule</h2><p className="tt-card__hint">End times are derived from the saved batch duration. Published sessions are protected during regeneration.</p></div></div></div>{conflicts.length > 0 && <div className="tt-conflicts" role="alert">{conflicts.map((item) => <article className="tt-conflict" key={item.id}><AlertCircle size={16}/><div><strong className="tt-conflict__type">{item.session.batchName || batchById.get(item.session.batchDocId)?.name}</strong><p className="tt-conflict__message">{item.message}</p></div></article>)}</div>}{visibleSessions.length ? <div className="tt-daylist">{visibleSessions.map((session) => { const batch = batchById.get(session.batchDocId); if (!batch) return null; return <article className="tt-daylist__row" key={session.id}><strong>{dayTitle(session.day)}</strong><span className="tt-daylist__time">{timeLabel(session.startMinutes)} – {timeLabel(session.endMinutes)}</span><span className="tt-daylist__batch">{batch.name} · {batch.courseName || batch.course}</span><span className="tt-daylist__meta">{roomById.get(session.roomId)?.name || session.roomName || 'Online'}</span><span className="tt-daylist__meta">{session.teacherName || batch.teacherName || 'Trainer'}</span><span className="tt-pill">{session.status || 'DRAFT'} · {session.durationMinutes / 60} h</span><span className="tt-daylist__actions">{owner && <><button className="tt-icon-btn" aria-label={`Edit ${batch.name}`} disabled={busy} onClick={() => openEditor(session)}><Clock3 size={14}/></button>{session.status !== 'PUBLISHED' && <button className="tt-icon-btn tt-icon-btn--danger" aria-label={`Remove ${batch.name}`} disabled={busy} onClick={() => remove(session)}><Trash size={14}/></button>}</>}</span></article>; })}</div> : <div className="tt-empty"><CalendarDays size={24}/><p className="tt-empty__title">No timetable sessions yet</p><p className="tt-empty__text">{owner ? 'Configure the institute hours and rooms, then generate the weekly schedule.' : 'The Owner has not published timetable sessions yet.'}</p></div>}
      {unscheduled.length > 0 && <div className="tt-unscheduled"><h3 className="tt-card__title">Sessions that still need scheduling</h3>{unscheduled.map(({ batch, placed, required, reason }) => <article className="tt-unscheduled__row" key={batch.documentId}><div><strong className="tt-unscheduled__name">{batch.name} · {batch.batchId}</strong><p className="tt-unscheduled__meta">{placed} of {required} weekly sessions placed · {durationMinutes(batch) ? `${durationMinutes(batch) / 60} h per session` : 'duration missing'}</p><p className="tt-unscheduled__reason"><AlertCircle size={14}/>{reason}</p></div>{owner && durationMinutes(batch) && <button className="tt-btn tt-btn--ghost" onClick={() => openEditor(null, batch)}><Plus size={14}/> Assign manually</button>}</article>)}</div>}
      </section>
    </>}
    {editing && <div className="tt-modal" role="presentation"><section className="tt-modal__panel" role="dialog" aria-modal="true" aria-labelledby="tt-editor-title"><header className="tt-modal__head"><h2 className="tt-modal__title" id="tt-editor-title">Edit scheduled class</h2><button className="tt-icon-btn" aria-label="Close" onClick={() => setEditing(null)}>×</button></header><div className="tt-modal__body"><p className="tt-editor__batch">{batchById.get(editing.batchDocId)?.name} · {durationMinutes(batchById.get(editing.batchDocId)) / 60} hour(s)</p><div className="tt-form-grid"><label className="tt-field"><span className="tt-field__label">Day</span><select value={editing.day} onChange={(event) => updateEditor({ day: event.target.value })}>{settings.workingDays.map((day) => <option value={day} key={day}>{dayTitle(day)}</option>)}</select></label><label className="tt-field"><span className="tt-field__label">Start time</span><input type="time" step={Number(settings.slotIncrement) * 60} value={toTime(editing.startMinutes)} onChange={(event) => updateEditor({ startMinutes: toMinutes(event.target.value) })}/></label><label className="tt-field"><span className="tt-field__label">End time (calculated)</span><input readOnly value={toTime(editing.endMinutes)}/></label><label className="tt-field"><span className="tt-field__label">Room</span><select value={editing.roomId} onChange={(event) => updateEditor({ roomId: event.target.value })}>{(batchById.get(editing.batchDocId)?.learningModes || []).includes('OFFLINE') && settings.rooms.map((room) => <option value={room.id} key={room.id}>{room.name} · capacity {room.capacity}</option>)}{!(batchById.get(editing.batchDocId)?.learningModes || ['OFFLINE']).includes('OFFLINE') && <option value="ONLINE">Online</option>}</select></label><label className="tt-field"><span className="tt-field__label">Teacher</span><select value={editing.teacherId} onChange={(event) => updateEditor({ teacherId: event.target.value })}>{teachers.map((teacher) => <option key={teacher.uid} value={teacher.uid}>{teacher.name || teacher.email}</option>)}</select></label></div><p className="tt-editor__hint">Editing a time changes the start only; the batch duration stays {editing.durationMinutes} minutes.</p>{editorErrors.length > 0 && <ul className="tt-form-errors">{editorErrors.map((item) => <li key={item}><AlertCircle size={14}/>{item}</li>)}</ul>}</div><footer className="tt-modal__foot"><button className="tt-btn tt-btn--ghost" onClick={() => setEditing(null)}>Cancel</button><button className="tt-btn tt-btn--primary" disabled={busy} onClick={saveEditor}><Save size={14}/> Save session</button></footer></section></div>}
  </div>;
}
