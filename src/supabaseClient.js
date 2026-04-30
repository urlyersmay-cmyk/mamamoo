function normalizeSupabaseRestUrl(rawUrl) {
  const fallback = 'https://rmxvqxnxaconpkpoftnr.supabase.co/rest/v1';
  const input = (rawUrl || fallback).trim().replace(/\/+$/, '');

  if (input.endsWith('/rest/v1')) {
    return input;
  }

  return `${input}/rest/v1`;
}

export const SUPABASE_REST_URL = normalizeSupabaseRestUrl(process.env.REACT_APP_SUPABASE_REST_URL);
export const SUPABASE_ANON_KEY =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  'sb_publishable_jau2dLQcTEK7z5XlP2AesA_BhUmwsdl';

