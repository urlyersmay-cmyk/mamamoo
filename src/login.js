import { useEffect, useState } from 'react';

const SUPABASE_REST_URL =
  process.env.REACT_APP_SUPABASE_REST_URL || 'https://rmxvqxnxaconpkpoftnr.supabase.co/rest/v1';
const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY || 'sb_publishable_jau2dLQcTEK7z5XlP2AesA_BhUmwsdl';

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_REST_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorMessage = 'Supabase request failed';
    try {
      const errorData = await response.json();
      errorMessage = errorData?.message || errorData?.error || errorMessage;
    } catch {
      // Keep fallback message.
    }
    throw new Error(errorMessage);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export default function Login({ onSuccess, initialUsername = '' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (initialUsername) {
      setEmail(initialUsername);
    }
  }, [initialUsername]);

  const handleLogin = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!normalizedEmail || !trimmedPassword) {
      setStatus('Enter email and password.');
      return;
    }

    try {
      const data = await supabaseRequest('/rpc/app_log_in', {
        method: 'POST',
        body: JSON.stringify({
          p_email: normalizedEmail,
          p_password: trimmedPassword,
        }),
      });
      const user = Array.isArray(data) ? data[0] : data;
      if (!user?.email) {
        throw new Error('Invalid login response');
      }
      setStatus('Logged in.');
      setPassword('');
      if (typeof onSuccess === 'function') {
        onSuccess(user);
      }
    } catch (error) {
      setStatus(error.message || 'Invalid email or password.');
    }
  };

  return (
    <form onSubmit={handleLogin} className="auth-form" aria-label="Login form">
      <label className="field">
        <span>Username</span>
        <input
          type="text"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="your username"
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Your password"
        />
      </label>
      <button type="submit">Log in</button>
      <p className="privacy-note" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
