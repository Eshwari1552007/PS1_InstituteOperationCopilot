import { auth } from '../firebase';

async function request(path, body = {}) {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('Sign in again to take attendance.'), { code: 'AUTH_REQUIRED' });
  const token = await user.getIdToken();
  const baseUrl = (process.env.REACT_APP_API_URL || '').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/attendance${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || 'Attendance could not be saved.'), { code: data.code || 'ATTENDANCE_FAILED', status: response.status });
  return data;
}

export const openAttendanceOccurrence = (timetableSessionId, date) => request('/sessions/open', { timetableSessionId, date });
export const saveAttendanceRecords = (sessionId, records) => request(`/sessions/${encodeURIComponent(sessionId)}/records`, { records });
export const finalizeAttendanceOccurrence = (sessionId) => request(`/sessions/${encodeURIComponent(sessionId)}/finalize`);
export const cancelAttendanceOccurrence = (sessionId) => request(`/sessions/${encodeURIComponent(sessionId)}/cancel`);
