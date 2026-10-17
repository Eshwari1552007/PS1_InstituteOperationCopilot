import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, Check, DoorOpen, Loader, Plus, RefreshCw, Save, Sparkles, Trash, Users } from 'lucide-react';
import { DEFAULT_SETTINGS, DAYS, durationMinutes, filterEligibleBatches, generateSchedule, preferredDays, sessionConflicts, toMinutes, toTime, validateSettings, weeklyHours } from './scheduler';
import { deleteTimetableDraft, loadTimetableWorkspace, persistTimetable, publishTimetable } from './timetableService';
import WeeklyTimetable from './WeeklyTimetable';
import { saveBatch } from '../batches/academyService';
import { useToast } from '../components/Toast';
import './Timetable.css';

const dayTitle = (key) => DAYS.find((day) => day.key === key)?.label || key;
const defaultBreak = () => ({ id: `break-${Date.now()}`, name: 'Break', enabled: true, startTime: '11:00', endTime: '11:15' });

export default function Timetable({ profile, initialBatchId = '' }) {
  const toast = useToast();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [batches, setBatches] = useState([]); const [sessions, setSessions] = useState([]); const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [generationReport, setGenerationReport] = useState(null);
  const [dirtySettings, setDirtySettings] = useState(false); const [editing, setEditing] = useState(null); const [editorErrors, setEditorErrors] = useState([]);
  const owner = profile.role === 'OWNER';

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const workspace = await loadTimetableWorkspace(profile);
      setSettings(workspace.settings); setBatches(workspace.batches); setSessions(workspace.sessions); setTeachers(workspace.teachers); setDirtySettings(false);
    } catch (failure) { const text = failure.code === 'permission-denied' ? 'Firestore denied timetable access. Owners manage schedules; trainers can view their assigned classes. Confirm the current security rules are deployed.' : failure.message; setError(text); toast.error(text, 'Timetable'); }
    finally { setLoading(false); }
  }, [profile, toast]);
  useEffect(() => { refresh(); }, [refresh]);

  const issues = useMemo(() => validateSettings(settings), [settings]);
  const conflicts = useMemo(() => [
    ...sessions.flatMap((session) => sessionConflicts(session, sessions, batches, settings, session.id).map((message) => ({ id: `${session.id}-${message}`, session, message }))),
    ...sessions.filter((session) => session.needsReview).map((session) => ({ id: `${session.id}-needs-review`, session, message: session.reviewReason || 'This session needs Owner review after a batch requirement changed.' })),
  ], [sessions, batches, settings]);
  const batchById = useMemo(() => new Map(batches.map((batch) => [batch.documentId, batch])), [batches]);
  const roomById = useMemo(() => new Map((settings.rooms || []).map((room) => [room.id, room])), [settings.rooms]);
  const scheduledMinutesByBatch = useMemo(() => sessions.reduce((map, session) => map.set(session.batchDocId, (map.get(session.batchDocId) || 0) + Number(session.durationMinutes || session.endMinutes - session.startMinutes)), new Map()), [sessions]);
  const nextDuration = (batch) => {
    const remaining = weeklyHours(batch) ? weeklyHours(batch) * 60 - (scheduledMinutesByBatch.get(batch.documentId) || 0) : durationMinutes(batch, 1);
    return remaining > 0 ? Math.min(120, remaining) : null;
  };
  const activeBatches = useMemo(() => filterEligibleBatches(batches), [batches]);
  const unscheduled = activeBatches.flatMap((batch) => {
    const required = weeklyHours(batch);
    const scheduled = sessions.filter((session) => session.batchDocId === batch.documentId).reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes) / 60, 0);
    if (required && scheduled === required) return [];
    return [{ batch, required, scheduled, missing: Math.max(0, Number(required || 0) - scheduled), reason: !required ? 'Set a positive whole-number teaching-hours-per-week value on this legacy batch.' : scheduled > required ? `${scheduled} scheduled hours exceed the ${required}-hour weekly requirement. Reduce or remove reviewed sessions.` : !settings.rooms.length && (batch.learningModes || ['OFFLINE']).includes('OFFLINE') ? 'Configure at least one room with enough capacity.' : `${scheduled} of ${required} required weekly hours scheduled; resolve the remaining time, trainer, room, batch, or availability constraints.` }];
  });
  const status = sessions.some((session) => session.status === 'PUBLISHED') ? 'Published' : sessions.length ? 'Draft' : 'Not generated';

  const updateSettings = (patch) => { setSettings((current) => ({ ...current, ...patch })); setDirtySettings(true); setNotice(''); };
  const updateRoom = (id, patch) => updateSettings({ rooms: settings.rooms.map((room) => room.id === id ? { ...room, ...patch } : room) });
  const addRoom = () => updateSettings({ rooms: [...settings.rooms, { id: `room-${Date.now()}`, name: `Room ${settings.rooms.length + 1}`, type: 'Classroom', capacity: 30 }] });
  const removeRoom = (id) => updateSettings({ rooms: settings.rooms.filter((room) => room.id !== id) });
  const updateBreak = (id, patch) => updateSettings({ breaks: settings.breaks.map((item) => item.id === id ? { ...item, ...patch } : item) });

  const save = async (nextSessions = sessions, nextSettings = settings) => {
    setBusy(true); setError(''); setNotice('');
    try { await persistTimetable(nextSettings, nextSessions, sessions); setSessions(nextSessions); setSettings(nextSettings); setDirtySettings(false); setNotice('Timetable changes saved to Firestore.'); toast.success('Timetable changes saved to Firestore.', 'Timetable'); }
    catch (failure) { const text = failure.code === 'permission-denied' ? 'Only an approved Owner can save timetable changes. Confirm the Owner account is active.' : `Could not save timetable: ${failure.message}`; setError(text); toast.error(text, 'Save failed'); throw failure; }
    finally { setBusy(false); }
  };
  const generate = async () => {
    if (issues.length) { const text = issues.join(' '); setError(text); toast.warning(text, 'Fix the scheduling settings'); return; }
    if (dirtySettings) { const text = 'Save the scheduling settings first, then generate.'; setError(text); toast.warning(text, 'Settings not saved'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = generateSchedule(settings, batches, sessions);
      await persistTimetable(settings, result.sessions, sessions);
      setSessions(result.sessions);
      setGenerationReport(result);
      const text = result.unscheduled.length ? `Generated and saved ${result.sessions.length} class session(s). ${result.unscheduled.length} batch(es) still need a slot; see the reasons below.` : `Generated and saved ${result.sessions.length} weekly class session(s).`;
      setNotice(text); toast.success(text, 'Timetable generated');
    } catch (failure) { const text = failure.code === 'permission-denied' ? 'Only an approved Owner can generate and save the timetable.' : `Timetable generation could not be saved: ${failure.message}`; setError(text); toast.error(text, 'Generation failed'); }
    finally { setBusy(false); }
  };
  const openEditor = (session = null, batch = null) => {
    const target = batch || batchById.get(session?.batchDocId);
    const room = settings.rooms.find((item) => item.id === session?.roomId) || settings.rooms[0];
    const index = session?.sessionIndex || Math.max(0, ...sessions.filter((item) => item.batchDocId === target?.documentId).map((item) => Number(item.sessionIndex) || 0)) + 1;
    const legacySessionDuration = session ? session.endMinutes - session.startMinutes : null;
    const duration = session?.needsReview ? (nextDuration(target) || durationMinutes(target, session.sessionIndex || index) || legacySessionDuration) : (legacySessionDuration || nextDuration(target));
    const firstDay = settings.workingDays.find((day) => preferredDays(target || {}).includes(day)) || settings.workingDays[0] || 'Mon';
    const start = session?.startMinutes ?? toMinutes(settings.openTime);
    const onlineOnly = target && !(target.learningModes || ['OFFLINE']).includes('OFFLINE');
    setEditing({ id: session?.id || `${target.documentId}__manual-${Date.now()}`, batchDocId: target?.documentId || '', day: session?.day || firstDay, startMinutes: start, endMinutes: start + (duration || 0), durationMinutes: duration || 0, roomId: session?.roomId || (onlineOnly ? 'ONLINE' : room?.id || ''), teacherId: session?.teacherId || target?.teacherId || '', source: session?.source || 'MANUAL', status: 'DRAFT', sessionIndex: index, needsReview: Boolean(session?.needsReview) });
    setEditorErrors([]);
  };
  const updateEditor = (patch) => setEditing((current) => {
    if (!current) return current;
    const next = { ...current, ...patch };
    if ('startMinutes' in patch) next.endMinutes = Number(patch.startMinutes) + current.durationMinutes;
    if ('durationMinutes' in patch) next.endMinutes = current.startMinutes + Number(patch.durationMinutes);
    return next;
  });
  const saveEditor = async () => {
    const errors = sessionConflicts(editing, sessions, batches, settings, editing.id);
    const batch = batchById.get(editing.batchDocId);
    const requiredMinutes = weeklyHours(batch) * 60;
    const otherMinutes = sessions.filter((session) => session.batchDocId === editing.batchDocId && session.id !== editing.id).reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes), 0);
    const priorSession = sessions.find((session) => session.id === editing.id);
    const priorMinutes = Number(priorSession?.durationMinutes || (priorSession ? priorSession.endMinutes - priorSession.startMinutes : 0));
    if (requiredMinutes && editing.durationMinutes > priorMinutes && otherMinutes + editing.durationMinutes > requiredMinutes) errors.push('This session would exceed the batch’s total weekly teaching-hours requirement.');
    if (errors.length) return setEditorErrors(errors);
    const room = roomById.get(editing.roomId);
    const teacher = teachers.find((item) => item.uid === editing.teacherId);
    const changedTeacher = editing.teacherId !== batch.teacherId;
    const nextBatch = changedTeacher ? { ...batch, teacherId: editing.teacherId, teacherName: teacher?.name || teacher?.email || batch.teacherName } : batch;
    const next = { ...editing, batchId: batch.batchId, batchName: batch.name, courseName: batch.courseName || batch.course, roomName: room?.name || 'Online', teacherName: nextBatch.teacherName || '', source: 'MANUAL', updatedBy: profile.uid, needsReview: false, reviewReason: '' };
    const nextSessions = [...sessions.filter((session) => session.id !== editing.id).map((session) => session.batchDocId === batch.documentId && changedTeacher ? { ...session, teacherId: nextBatch.teacherId, teacherName: nextBatch.teacherName } : session), next].sort((a, b) => DAYS.findIndex((day) => day.key === a.day) - DAYS.findIndex((day) => day.key === b.day) || a.startMinutes - b.startMinutes);
    try {
      if (changedTeacher) { await saveBatch(nextBatch, profile.uid, batch.documentId); setBatches((current) => current.map((item) => item.documentId === batch.documentId ? nextBatch : item)); }
      await save(nextSessions); setEditing(null);
    } catch { /* error is displayed above the editor */ }
  };
  const remove = async (session) => {
    if (session.status === 'PUBLISHED') { const text = 'This session is published. Unpublish it before removing or rescheduling.'; setError(text); toast.warning(text, 'Published session'); return; }
    setBusy(true); setError('');
    try { await deleteTimetableDraft(session); const next = sessions.filter((item) => item.id !== session.id); setSessions(next); setNotice('Draft session removed.'); toast.success('Draft session removed.', 'Timetable'); }
    catch (failure) { const text = `Could not remove the session: ${failure.message}`; setError(text); toast.error(text, 'Remove failed'); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!sessions.length || unscheduled.length || conflicts.length || issues.length || dirtySettings) { const text = 'Save valid settings, resolve all schedule conflicts, and schedule every active batch before publishing.'; setError(text); toast.warning(text, 'Cannot publish yet'); return; }
    setBusy(true); setError('');
    try { await publishTimetable(sessions.filter((item) => item.status !== 'PUBLISHED')); const published = sessions.map((item) => ({ ...item, status: 'PUBLISHED' })); setSessions(published); setNotice('Timetable published.'); toast.success('Timetable published.', 'Timetable'); }
    catch (failure) { const text = `Could not publish timetable: ${failure.message}`; setError(text); toast.error(text, 'Publish failed'); }
    finally { setBusy(false); }
  };

  return <div className="tt-root">
    <header className="tt-header"><div className="tt-header__text"><p className="tt-header__eyebrow">EDUPILOT · ACADEMICS</p><h1 className="tt-header__title">{profile.role === 'STUDENT' ? 'My Timetable' : 'Timetable Management'}</h1><p className="tt-header__subtitle">{profile.role === 'STUDENT' ? 'View the published schedule for your active batch enrollments.' : 'Schedule weekly batch teaching hours and review the date-specific institute timetable.'}</p></div><div className="tt-header__actions"><span className={`tt-state tt-state--${status.toLowerCase().replace(' ', '-')}`}>{status}</span><button className="tt-btn tt-btn--ghost" onClick={refresh} disabled={loading || busy}><RefreshCw size={15}/> Refresh</button>{owner && <><button className="tt-btn tt-btn--primary" onClick={generate} disabled={busy || loading}><Sparkles size={15}/>{busy ? 'Working…' : 'Generate timetable'}</button><button className="tt-btn" onClick={publish} disabled={busy || !sessions.length}>Publish</button></>}</div></header>
    {error && <p className="tt-banner tt-banner--warn" role="alert"><AlertCircle size={16}/>{error}</p>}{notice && <p className="tt-banner tt-banner--ok" role="status"><Check size={16}/>{notice}</p>}
    {loading ? <div className="tt-empty"><Loader className="tt-spin"/><p className="tt-empty__title">Loading Firestore timetable…</p></div> : <>
      <section className="tt-summaries" aria-label="Timetable statistics"><article className="tt-summary"><span className="tt-summary__icon"><DoorOpen size={18}/></span><div><p className="tt-summary__label">Rooms configured</p><p className="tt-summary__value">{settings.rooms.length}</p></div></article><article className="tt-summary"><span className="tt-summary__icon"><Users size={18}/></span><div><p className="tt-summary__label">Active batches</p><p className="tt-summary__value">{activeBatches.length}</p></div></article><article className="tt-summary"><span className="tt-summary__icon"><CalendarDays size={18}/></span><div><p className="tt-summary__label">Weekly sessions</p><p className="tt-summary__value">{sessions.length}</p></div></article><article className="tt-summary"><span className="tt-summary__icon"><AlertCircle size={18}/></span><div><p className="tt-summary__label">Unscheduled batches</p><p className="tt-summary__value">{unscheduled.length}</p></div></article></section>
      {owner && generationReport && <section className="tt-card"><div className="tt-card__head"><div><h2 className="tt-card__title">Generation audit &amp; resource utilization</h2><p className="tt-card__hint">{generationReport.eligibleCount} eligible batches · {generationReport.courseCount} courses · {generationReport.trainerCount} trainers · {generationReport.roomCount} rooms · {generationReport.report.filter((item) => item.status === 'COMPLETE').length} complete · {generationReport.report.filter((item) => item.status === 'PARTIAL').length} partial · {generationReport.report.filter((item) => item.status === 'UNSCHEDULED').length} unscheduled</p></div></div><p className="tt-card__hint">Required {generationReport.totals.requiredHours} h/week · Scheduled {generationReport.totals.scheduledHours} h/week · Missing {generationReport.totals.missingHours} h/week · {conflicts.length} current conflict(s)</p>
        <h3 className="tt-card__title">Batch compliance</h3><div className="tt-table-wrap"><table className="tt-table"><thead><tr><th>Batch</th><th>Course</th><th>Required h/week</th><th>Scheduled h/week</th><th>Missing hours</th><th>Lectures</th><th>Status / reason</th></tr></thead><tbody>{generationReport.report.map((item) => <tr key={item.batchDocId}><td>{item.batchName}</td><td>{item.courseName || 'Course not linked'}</td><td>{item.requiredHours}</td><td>{item.scheduledHours}</td><td>{item.missingHours}</td><td>{item.lectureCount}</td><td><span className={`tt-pill tt-pill--${item.status === 'COMPLETE' ? 'good' : item.status === 'PARTIAL' ? 'warn' : 'bad'}`}>{item.status}</span>{item.reason ? ` · ${item.reason}` : ''}</td></tr>)}</tbody></table></div>
        {generationReport.roomUtilization.length > 0 && <><h3 className="tt-card__title">Room utilization</h3><div className="tt-table-wrap"><table className="tt-table"><thead><tr><th>Room</th><th>Type</th><th>Sessions</th><th>Occupied room-hours</th><th>Available room-hours</th><th>Utilization</th></tr></thead><tbody>{generationReport.roomUtilization.map((room) => <tr key={room.roomId}><td>{room.name}</td><td>{room.type}</td><td>{room.sessions}</td><td>{room.occupiedHours}</td><td>{room.availableHours ?? '—'}</td><td>{room.utilization === null ? '—' : `${room.utilization}%`}</td></tr>)}</tbody></table></div></>}
        {generationReport.issues.length > 0 && <ul className="tt-form-errors">{generationReport.issues.map((item) => <li key={item}><AlertCircle size={14}/>{item}</li>)}</ul>}
      </section>}
      {owner && <section className="tt-card"><div className="tt-card__head"><div className="tt-card__titlewrap"><span className="tt-card__icon"><CalendarDays size={17}/></span><div><h2 className="tt-card__title">Institute scheduling settings</h2><p className="tt-card__hint">These settings and rooms are stored with the timetable. Old batch clock times are preserved as legacy values.</p></div></div>{dirtySettings && <span className="tt-pill tt-pill--warn">Unsaved settings</span>}</div>
        <div className="tt-form-grid"><label className="tt-field"><span className="tt-field__label">Opening time</span><input type="time" value={settings.openTime} onChange={(event) => updateSettings({ openTime: event.target.value })}/></label><label className="tt-field"><span className="tt-field__label">Closing time</span><input type="time" value={settings.closeTime} onChange={(event) => updateSettings({ closeTime: event.target.value })}/></label><label className="tt-field"><span className="tt-field__label">Slot increment</span><select value={settings.slotIncrement} onChange={(event) => updateSettings({ slotIncrement: Number(event.target.value) })}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label></div>
        <fieldset className="tt-fieldset"><legend className="tt-fieldset__legend">Working days</legend><div className="tt-days">{DAYS.map((day) => <label className={`tt-day${settings.workingDays.includes(day.key) ? ' tt-day--active' : ''}`} key={day.key}><input type="checkbox" checked={settings.workingDays.includes(day.key)} onChange={() => updateSettings({ workingDays: settings.workingDays.includes(day.key) ? settings.workingDays.filter((item) => item !== day.key) : DAYS.filter((item) => item.key === day.key || settings.workingDays.includes(item.key)).map((item) => item.key) })}/>{day.label}</label>)}</div></fieldset>
        <div className="tt-breaks">{settings.breaks.map((item) => <div className="tt-break" key={item.id}><label className="tt-switch"><input type="checkbox" checked={item.enabled} onChange={(event) => updateBreak(item.id, { enabled: event.target.checked })}/><span>{item.name}</span></label><div className="tt-break__times"><input aria-label={`${item.name} starts`} type="time" value={item.startTime} disabled={!item.enabled} onChange={(event) => updateBreak(item.id, { startTime: event.target.value })}/><span className="tt-break__dash">to</span><input aria-label={`${item.name} ends`} type="time" value={item.endTime} disabled={!item.enabled} onChange={(event) => updateBreak(item.id, { endTime: event.target.value })}/></div><button className="tt-icon-btn tt-icon-btn--danger" aria-label={`Remove ${item.name}`} onClick={() => updateSettings({ breaks: settings.breaks.filter((entry) => entry.id !== item.id) })}><Trash size={14}/></button></div>)}</div><button className="tt-btn tt-btn--ghost" onClick={() => updateSettings({ breaks: [...settings.breaks, defaultBreak()] })}><Plus size={14}/> Add break</button>
        <div className="tt-rooms"><div className="tt-rooms__head"><div><h3 className="tt-card__title">Available rooms</h3><p className="tt-card__hint">Room capacity must accommodate the batch’s maximum enrollment.</p></div><button className="tt-btn tt-btn--ghost" onClick={addRoom}><Plus size={14}/> Add room</button></div><ul className="tt-room-list">{settings.rooms.map((room) => <li className="tt-room" key={room.id}><input aria-label="Room name" value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })}/><select aria-label={`Room type for ${room.name}`} value={room.type} onChange={(event) => updateRoom(room.id, { type: event.target.value })}><option>Classroom</option><option>Lab</option></select><input aria-label={`Capacity for ${room.name}`} type="number" min="1" value={room.capacity} onChange={(event) => updateRoom(room.id, { capacity: Number(event.target.value) })}/><button className="tt-icon-btn tt-icon-btn--danger" aria-label={`Remove ${room.name}`} onClick={() => removeRoom(room.id)}><Trash size={14}/></button></li>)}{!settings.rooms.length && <li className="tt-room tt-room--empty">No rooms configured. Add rooms before scheduling offline batches.</li>}</ul></div>
        {issues.length > 0 && <ul className="tt-form-errors">{issues.map((item) => <li key={item}><AlertCircle size={14}/>{item}</li>)}</ul>}
        <footer className="tt-actions"><span className="tt-actions__note">Changes are stored in Firestore, not local browser state.</span><button className="tt-btn tt-btn--primary" disabled={busy || issues.length > 0 || !dirtySettings} onClick={() => save(sessions)}><Save size={15}/>{busy ? 'Saving…' : 'Save settings'}</button></footer>
      </section>}
      {!['STUDENT'].includes(profile.role) && <section className="tt-card"><div className="tt-card__head"><div className="tt-card__titlewrap"><span className="tt-card__icon"><Users size={17}/></span><div><h2 className="tt-card__title">Active batch requirements</h2><p className="tt-card__hint">Teaching hours are weekly totals; days off are excluded when generating sessions.</p></div></div></div>{activeBatches.length ? <div className="tt-table-wrap"><table className="tt-table"><thead><tr><th>Batch</th><th>Course</th><th>Trainer</th><th>Required / week</th><th>Scheduled / week</th><th>Days off</th>{owner && <th>Action</th>}</tr></thead><tbody>{activeBatches.map((batch) => { const required = weeklyHours(batch); const actual = sessions.filter((session) => session.batchDocId === batch.documentId).reduce((sum, session) => sum + Number(session.durationMinutes || session.endMinutes - session.startMinutes) / 60, 0); return <tr key={batch.documentId}><td><span className="tt-batch"><span className="tt-batch__id">{batch.batchId}</span><span className="tt-batch__name">{batch.name}</span></span></td><td>{batch.courseName || batch.course || '—'}</td><td>{batch.teacherName || batch.teacherId || '—'}</td><td>{required ? `${required} h` : <span className="tt-pill tt-pill--warn">Set hours</span>}</td><td>{actual} / {required || '—'} h</td><td>{batch.unavailableDays?.length ? batch.unavailableDays.join(', ') : 'None'}</td>{owner && <td><button className="tt-btn tt-btn--xs tt-btn--ghost" disabled={!nextDuration(batch) || !settings.workingDays.length || busy} onClick={() => openEditor(null, batch)}>Assign slot</button></td>}</tr>; })}</tbody></table></div> : <div className="tt-empty"><Users size={24}/><p className="tt-empty__title">No active batches found</p><p className="tt-empty__text">Create batches in Batches &amp; Courses. They will appear here automatically.</p></div>}</section>}
      <WeeklyTimetable profile={profile} initialBatchId={initialBatchId} batches={batches} sessions={sessions} settings={settings} roomById={roomById} conflicts={conflicts} onEdit={openEditor} onRemove={remove}/>
      {owner && unscheduled.length > 0 && <section className="tt-card"><h2 className="tt-card__title">Weekly hours needing review</h2><div className="tt-unscheduled">{unscheduled.map(({ batch, required, scheduled, missing, reason }) => <article className="tt-unscheduled__row" key={batch.documentId}><div><strong className="tt-unscheduled__name">{batch.name} · {batch.batchId}</strong><p className="tt-unscheduled__meta">{scheduled} of {required || '—'} hours scheduled · {missing} unscheduled</p><p className="tt-unscheduled__reason"><AlertCircle size={14}/>{reason}</p></div>{weeklyHours(batch) && nextDuration(batch) && <button className="tt-btn tt-btn--ghost" onClick={() => openEditor(null, batch)}><Plus size={14}/> Assign slot</button>}</article>)}</div></section>}
    </>}
    {editing && <div className="tt-modal" role="presentation"><section className="tt-modal__panel" role="dialog" aria-modal="true" aria-labelledby="tt-editor-title"><header className="tt-modal__head"><h2 className="tt-modal__title" id="tt-editor-title">Edit scheduled class</h2><button className="tt-icon-btn" aria-label="Close" onClick={() => setEditing(null)}>×</button></header><div className="tt-modal__body"><p className="tt-editor__batch">{batchById.get(editing.batchDocId)?.name} · {editing.durationMinutes / 60} hour(s)</p>{editing.needsReview && <p className="tt-editor__note">Batch requirements changed. Review this class length and time before publishing.</p>}<div className="tt-form-grid"><label className="tt-field"><span className="tt-field__label">Day</span><select value={editing.day} onChange={(event) => updateEditor({ day: event.target.value })}>{settings.workingDays.map((day) => <option value={day} key={day}>{dayTitle(day)}</option>)}</select></label>{editing.needsReview && weeklyHours(batchById.get(editing.batchDocId)) && <label className="tt-field"><span className="tt-field__label">Session length</span><select value={editing.durationMinutes} onChange={(event) => updateEditor({ durationMinutes: Number(event.target.value) })}><option value="60">1 hour</option><option value="120">2 hours</option></select></label>}<label className="tt-field"><span className="tt-field__label">Start time</span><input type="time" step={Number(settings.slotIncrement) * 60} value={toTime(editing.startMinutes)} onChange={(event) => updateEditor({ startMinutes: toMinutes(event.target.value) })}/></label><label className="tt-field"><span className="tt-field__label">End time (calculated)</span><input readOnly value={toTime(editing.endMinutes)}/></label><label className="tt-field"><span className="tt-field__label">Room</span><select value={editing.roomId} onChange={(event) => updateEditor({ roomId: event.target.value })}>{(batchById.get(editing.batchDocId)?.learningModes || []).includes('OFFLINE') && settings.rooms.map((room) => <option value={room.id} key={room.id}>{room.name} · capacity {room.capacity}</option>)}{!(batchById.get(editing.batchDocId)?.learningModes || ['OFFLINE']).includes('OFFLINE') && <option value="ONLINE">Online</option>}</select></label><label className="tt-field"><span className="tt-field__label">Teacher</span><select value={editing.teacherId} onChange={(event) => updateEditor({ teacherId: event.target.value })}>{teachers.map((teacher) => <option key={teacher.uid} value={teacher.uid}>{teacher.name || teacher.email}</option>)}</select></label></div><p className="tt-editor__hint">End time is calculated from this class’s allocated weekly hours.</p>{editorErrors.length > 0 && <ul className="tt-form-errors">{editorErrors.map((item) => <li key={item}><AlertCircle size={14}/>{item}</li>)}</ul>}</div><footer className="tt-modal__foot"><button className="tt-btn tt-btn--ghost" onClick={() => setEditing(null)}>Cancel</button><button className="tt-btn tt-btn--primary" disabled={busy} onClick={saveEditor}><Save size={14}/> Save session</button></footer></section></div>}
  </div>;
}
