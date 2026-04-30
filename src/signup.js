import { useState } from 'react';
import { SUPABASE_ANON_KEY, SUPABASE_REST_URL } from './supabaseClient';

async function supabaseRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${SUPABASE_REST_URL}${path}`, {
      ...options,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...options.headers,
      },
    });
  } catch {
    throw new Error(`Network error. Check Supabase URL/key config. URL: ${SUPABASE_REST_URL}`);
  }

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

export default function SignUp({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');

  const handleSignUp = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!normalizedEmail || !trimmedPassword) {
      setStatus('Enter email and password.');
      return;
    }

    try {
      const data = await supabaseRequest('/rpc/app_sign_up', {
        method: 'POST',
        body: JSON.stringify({
          p_email: normalizedEmail,
          p_password: trimmedPassword,
        }),
      });
      const user = Array.isArray(data) ? data[0] : data;
      if (!user?.email) {
        throw new Error('Invalid sign up response');
      }
      setStatus('Account created.');
      setPassword('');
      if (typeof onSuccess === 'function') {
        onSuccess(user);
      }
    } catch (error) {
      setStatus(error.message || 'Sign up failed.');
    }
  };

  return (
    <form onSubmit={handleSignUp} className="auth-form" aria-label="Sign up form">
      <label className="field">
        <span>Username</span>
        <input
          type="text"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="choose a username"
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
        />
      </label>
      <button type="submit">Sign up</button>
      <p className="privacy-note" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}
