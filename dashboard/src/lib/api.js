import { supabase } from '../supabase.js';

// Every call returns data or throws an Error whose message is safe to show.
function unwrap({ data, error }) {
  if (error) {
    const err = new Error(error.message || 'Something went wrong');
    err.code = error.code;
    throw err;
  }
  return data;
}

export const listTests = async () =>
  unwrap(await supabase.from('tests').select('*').order('created_at', { ascending: false }));

// Only what the list needs; student names never load on the tests list.
export const listAttemptSummaries = async () =>
  unwrap(await supabase.from('attempts').select('test_id, status, strikes'));

export const getTest = async (id) =>
  unwrap(await supabase.from('tests').select('*').eq('id', id).maybeSingle());

export const createTest = async (fields) =>
  unwrap(await supabase.from('tests').insert(fields).select().single());

export const updateTest = async (id, fields) =>
  unwrap(await supabase.from('tests').update(fields).eq('id', id).select().single());

export const deleteTest = async (id) => unwrap(await supabase.from('tests').delete().eq('id', id));

export const goLive = async (id, oneResponse, verifiedEmail) =>
  unwrap(await supabase.rpc('go_live', { p_test_id: id, p_one_response: oneResponse, p_verified_email: verifiedEmail }));

export const endTest = async (id) => unwrap(await supabase.rpc('end_test', { p_test_id: id }));

export const listAttempts = async (testId) =>
  unwrap(await supabase.from('attempts').select('*').eq('test_id', testId).order('started_at'));

export const getAttempt = async (id) =>
  unwrap(await supabase.from('attempts').select('id, test_id, student_name').eq('id', id).maybeSingle());

export const recentEvents = async (attemptIds, types, limit = 40) =>
  attemptIds.length
    ? unwrap(await supabase.from('events').select('id, attempt_id, type, t, data').in('attempt_id', attemptIds)
      .in('type', types).order('t', { ascending: false }).limit(limit))
    : [];

export const unlock = async (attemptId) =>
  unwrap(await supabase.from('commands').insert({ attempt_id: attemptId, type: 'unlock' }));
