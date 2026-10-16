import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the login screen with accessible fields', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/remember me/i)).toBeInTheDocument();
});
