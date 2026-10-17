import { fireEvent, render, screen } from '@testing-library/react';
import WeeklyTimetable from './WeeklyTimetable';

const profile = { role: 'OWNER', uid: 'owner-1' };
const batches = [1, 2, 3].map((index) => ({ documentId: `batch-${index}`, name: `Batch ${index}`, courseName: 'Course', teacherId: `teacher-${index}`, teacherName: `Trainer ${index}` }));
const sessions = [1, 2, 3].map((index) => ({
  id: `session-${index}`, batchDocId: `batch-${index}`, batchName: `Batch ${index}`, courseName: 'Course', teacherId: `teacher-${index}`, teacherName: `Trainer ${index}`,
  roomId: `room-${index}`, roomName: `Room ${index}`, day: 'Mon', startMinutes: 600, endMinutes: 720, durationMinutes: 120, status: 'DRAFT',
}));
const settings = { workingDays: ['Mon'], openTime: '09:00', closeTime: '18:00', slotIncrement: 30, breaks: [], holidays: [], rooms: [1, 2, 3, 4].map((index) => ({ id: `room-${index}`, name: `Room ${index}`, type: 'Classroom', capacity: 30 })) };

test('weekly view renders all simultaneous room sessions and room view includes an empty eligible room', () => {
  const { container } = render(<WeeklyTimetable profile={profile} batches={batches} sessions={sessions} settings={settings} roomById={new Map(settings.rooms.map((room) => [room.id, room]))} teachers={[]} conflicts={[]} onEdit={jest.fn()} onRemove={jest.fn()}/>);
  expect([...container.querySelectorAll('.tt-slot__name')].map((node) => node.textContent)).toEqual(['Batch 1', 'Batch 2', 'Batch 3']);
  const blocks = [...container.querySelectorAll('.tt-weekgrid__event')];
  expect(blocks).toHaveLength(3);
  expect(blocks.every((block) => block.rowSpan === 4)).toBe(true);
  expect(new Set(blocks.map((block) => block.parentElement)).size).toBe(1);
  expect(blocks.every((block) => block.parentElement.querySelector('th')?.textContent === '10:00 AM')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'By room' }));
  expect(screen.getAllByText('Room 4').length).toBeGreaterThan(0);
  expect(screen.getAllByText('No classes').length).toBeGreaterThan(0);
});
