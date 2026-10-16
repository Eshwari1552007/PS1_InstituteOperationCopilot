import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./auth/authService', () => ({
  observeAuth: (callback) => { callback(null); return () => {}; },
  login: jest.fn(),
  requestPasswordReset: jest.fn(),
  logout: jest.fn(),
  PUBLIC_ROLES: ['STUDENT'],
  completeProfile: jest.fn(),
}));
jest.mock('./firebase', () => ({ db: {} }));

test('renders the login screen with accessible fields', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: /smarter institutes with ai/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getAllByText('EDUPILOT', { exact: true }).length).toBeGreaterThan(0);
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/remember me/i)).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /student/i })).toBeChecked();
});
