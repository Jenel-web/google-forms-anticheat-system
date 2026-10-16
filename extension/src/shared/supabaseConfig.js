// Public by design: the anon key only identifies the project. Security is RLS + the RPCs (see CLAUDE.md).
// Defaults are the local `supabase start` values. For a hosted project build with
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<key> npm --prefix extension run build
// (build.mjs injects them as __SUPABASE_URL__ / __SUPABASE_ANON_KEY__). Never put the service-role key here.
/* global __SUPABASE_URL__, __SUPABASE_ANON_KEY__ */
export const SUPABASE_URL = typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : 'http://127.0.0.1:54321';
export const SUPABASE_ANON_KEY = typeof __SUPABASE_ANON_KEY__ !== 'undefined'
  ? __SUPABASE_ANON_KEY__
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
