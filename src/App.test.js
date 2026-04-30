import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the confession builder', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: /make the feeling/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/recipient/i)).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: /generated confession/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /voice/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /send text/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /generate qr and link/i })).toBeInTheDocument();
});
