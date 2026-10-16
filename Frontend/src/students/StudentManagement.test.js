import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StudentManagement from './StudentManagement';
import { listStudents, removeStudent, saveStudent } from './studentService';
import { getEnrollmentOptions } from '../batches/academyService';

jest.mock('./studentService', () => ({
  listStudents: jest.fn(),
  removeStudent: jest.fn(),
  saveStudent: jest.fn(),
}));
jest.mock('../batches/academyService', () => ({ getBatchDurationHours: jest.fn((batch) => batch?.durationHours || 1), getEnrollmentOptions: jest.fn() }));

const options = {
  courses: [{ documentId: 'course-doc-1', courseId: 'CRS-2026-0001', name: 'Science', status: 'ACTIVE' }],
  batches: [{ documentId: 'batch-doc-1', batchId: 'BAT-2026-0001', name: '2026-A', courseDocId: 'course-doc-1', capacity: 20, enrolledCount: 2, daysOfWeek: ['MON'], startTime: '09:00', endTime: '11:00', startDate: '2026-07-01', endDate: '2026-12-01' }],
};

const students = [
  { documentId: 'student-doc-1', studentId: 'STU-2026-0001', fullName: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', course: 'Science', courseDocId: 'course-doc-1', batch: '2026-A', batchDocId: 'batch-doc-1', admissionDate: '2026-07-01', status: 'ACTIVE' },
  { documentId: 'student-doc-2', studentId: 'STU-2026-0002', fullName: 'Ravi Shah', email: 'ravi@example.com', phone: '9876500000', course: 'Arts', batch: '2026-B', admissionDate: '2026-07-05', status: 'PENDING' },
];

beforeEach(() => {
  jest.clearAllMocks();
  listStudents.mockResolvedValue({ records: students, warnings: [] });
  getEnrollmentOptions.mockResolvedValue(options);
});

test('loads Firestore-backed summary counts and filters student rows', async () => {
  render(<StudentManagement profile={{ uid: 'owner-1', role: 'OWNER' }} />);

  expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  expect(screen.getByText('Total Students').nextElementSibling).toHaveTextContent('2');
  expect(screen.getByText('Active Students').nextElementSibling).toHaveTextContent('1');
  expect(screen.getByText('Not Enrolled').nextElementSibling).toHaveTextContent('0');

  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by course' }), { target: { value: 'Arts' } });
  expect(screen.getByText('Ravi Shah')).toBeInTheDocument();
  expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
});

test('shows a retry action when Firestore cannot load student records', async () => {
  listStudents.mockRejectedValueOnce(new Error('temporary network error'));
  render(<StudentManagement profile={{ uid: 'owner-1', role: 'OWNER' }} />);
  expect(await screen.findByText(/temporary network error/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  await waitFor(() => expect(listStudents).toHaveBeenCalledTimes(2));
});

test('keeps delete action absent for Counselors', async () => {
  render(<StudentManagement profile={{ uid: 'counselor-1', role: 'COUNSELOR' }} />);
  expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete Asha Rao' })).not.toBeInTheDocument();
  expect(saveStudent).not.toHaveBeenCalled();
  expect(removeStudent).not.toHaveBeenCalled();
});

test('shows existing Owner-visible Student account profiles when student directory rules deny access', async () => {
  const accountOnlyStudent = { ...students[0], source: 'account-profile', studentId: '', course: '', batch: '', status: 'ACTIVE' };
  listStudents.mockResolvedValueOnce({
    records: [accountOnlyStudent],
    warnings: ['Firestore denied access to the students collection. Showing Student account profiles only.'],
  });
  render(<StudentManagement profile={{ uid: 'owner-1', role: 'OWNER' }} />);
  expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  expect(screen.getByText('Account profile only')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/Firestore denied access/i);
  expect(screen.queryByRole('button', { name: 'Edit Asha Rao' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete Asha Rao' })).not.toBeInTheDocument();
});

test('submits a valid new record and refreshes the directory after Firebase confirms it', async () => {
  render(<StudentManagement profile={{ uid: 'owner-1', role: 'OWNER' }} />);
  await screen.findByText('Asha Rao');
  fireEvent.click(screen.getByRole('button', { name: /add student/i }));
  await screen.findByRole('heading', { name: 'Add student' });
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Nila Das' } });
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'nila@example.com' } });
  fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: '9000000000' } });
  fireEvent.change(screen.getByLabelText(/course \/ program/i), { target: { value: 'course-doc-1' } });
  fireEvent.change(screen.getByLabelText(/^batch/i), { target: { value: 'batch-doc-1' } });
  fireEvent.change(screen.getByLabelText(/admission date/i), { target: { value: '2026-07-10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add student' }));
  await waitFor(() => expect(saveStudent).toHaveBeenCalledWith(expect.objectContaining({ studentId: '', courseDocId: 'course-doc-1', batchDocId: 'batch-doc-1', fullName: 'Nila Das' }), 'owner-1', ''));
  expect(await screen.findByRole('status')).toHaveTextContent('Student added successfully.');
  await waitFor(() => expect(listStudents).toHaveBeenCalledTimes(2));
});

test('shows student details and asks for confirmation before Owner archival', async () => {
  render(<StudentManagement profile={{ uid: 'owner-1', role: 'OWNER' }} />);
  await screen.findByText('Asha Rao');
  fireEvent.click(screen.getByRole('button', { name: 'View Asha Rao' }));
  expect(screen.getByRole('heading', { name: 'Student details' })).toBeInTheDocument();
  expect(screen.getByDisplayValue('asha@example.com')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]);
  fireEvent.click(screen.getByRole('button', { name: 'Archive Asha Rao' }));
  expect(screen.getByRole('alertdialog')).toHaveTextContent('preserving their record');
  expect(removeStudent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Archive student' }));
  await waitFor(() => expect(removeStudent).toHaveBeenCalledWith('student-doc-1', 'owner-1'));
});
