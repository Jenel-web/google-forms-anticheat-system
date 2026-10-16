"""Black-box isolation check against a running local stack (standard library only).

  export SUPABASE_URL=http://127.0.0.1:54321
  export SUPABASE_ANON_KEY=<anon key from `supabase status`>
  python supabase/tests/anon_isolation.py

Needs the seed (teacher@example.com + the live form 'seed-form-id-local-dev'). Every run leaves one unfinished
attempt behind (the first student's), which is handy for trying the Studio SQL steps.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mailpit

URL = os.environ.get('SUPABASE_URL', '').rstrip('/')
KEY = os.environ.get('SUPABASE_ANON_KEY', '')
if not URL or not KEY:
    sys.exit('Set SUPABASE_URL and SUPABASE_ANON_KEY first (see the docstring).')

FORM = 'seed-form-id-local-dev'
failures = 0


def call(method, path, token=None, body=None, extra=None):
    headers = {'apikey': KEY, 'Authorization': 'Bearer ' + (token or KEY), 'Content-Type': 'application/json'}
    headers.update(extra or {})
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors='replace')


def rpc(name, token, **args):
    return call('POST', '/rest/v1/rpc/' + name, token, args)


def check(ok, label, detail=''):
    global failures
    if not ok:
        failures += 1
    print(('PASS  ' if ok else 'FAIL  ') + label + ('' if ok or not detail else '   -> ' + str(detail)[:200]))


def denied(res):
    status, body = res
    return status in (401, 403) and isinstance(body, dict) and body.get('code') in ('42501', 'PGRST301', 'PGRST302')


def empty_or_denied(res):
    status, body = res
    return (status == 200 and body == []) or denied(res)


def err_code(res):
    return res[1].get('code') if isinstance(res[1], dict) else None


def claims(token):
    part = token.split('.')[1]
    return json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))


def anonymous_user():
    status, body = call('POST', '/auth/v1/signup', body={})
    assert status == 200 and body.get('access_token'), 'anonymous sign-in failed (is it enabled?): %s %s' % (status, body)
    return body['access_token']


# ---- 1. not signed in (anon key only) ----
for table in ('tests', 'attempts', 'events', 'commands'):
    r = call('GET', '/rest/v1/%s?select=*' % table)
    check(denied(r), 'no session cannot read ' + table, r)
r = rpc('get_live_test', None, p_form_id=FORM)
check(denied(r), 'no session cannot call get_live_test', r)
r = rpc('start_attempt', None, p_form_id=FORM, p_name='X', p_email='x@example.com')
check(denied(r), 'no session cannot call start_attempt', r)

# ---- 2. two anonymous students ----
tok_a, tok_b = anonymous_user(), anonymous_user()
check(claims(tok_a).get('is_anonymous') is True, 'student token carries is_anonymous=true')
check(claims(tok_a)['sub'] != claims(tok_b)['sub'], 'two students have different uids')

for table in ('tests', 'attempts', 'events', 'commands'):
    r = call('GET', '/rest/v1/%s?select=*' % table, tok_a)
    check(empty_or_denied(r), 'student cannot read ' + table, r)
for table, row in (('tests', {'title': 'x', 'form_id': 'y', 'form_url': 'z', 'status': 'live'}),
                   ('attempts', {'test_id': str(uuid.uuid4()), 'student_name': 'x', 'student_email': 'x@example.com'}),
                   ('commands', {'attempt_id': str(uuid.uuid4()), 'type': 'unlock'}),
                   ('events', {'attempt_id': str(uuid.uuid4()), 't': '2026-01-01T00:00:00Z', 'type': 'x'})):
    r = call('POST', '/rest/v1/' + table, tok_a, row)
    check(denied(r), 'student cannot insert into ' + table, r)
r = call('PATCH', '/rest/v1/attempts?student_name=neq.zzz', tok_a, {'strikes': 0})
check(denied(r), 'student cannot update attempts', r)
r = call('DELETE', '/rest/v1/attempts?student_name=neq.zzz', tok_a)
check(denied(r), 'student cannot delete attempts', r)

r = rpc('get_live_test', tok_a, p_form_id=FORM)
check(r[0] == 200 and len(r[1]) == 1, 'student can look up the live test', r)
r = rpc('get_live_test', tok_a, p_form_id='no-such-form')
check(r[0] == 200 and r[1] == [], 'unknown form returns nothing', r)

r = rpc('start_attempt', tok_a, p_form_id=FORM, p_name='Ann', p_email='ann@example.com',
        p_chrome_email='ann@example.com', p_ext_version='test')
attempt_a = r[1]['id'] if r[0] == 200 else None
check(attempt_a is not None and r[1]['verified'] is True and r[1]['strikes'] == 0, 'student A starts an attempt (verified)', r)
r = rpc('start_attempt', tok_a, p_form_id=FORM, p_name='Ann', p_email='ann@example.com')
check(r[0] == 200 and r[1]['id'] == attempt_a, 'second start_attempt returns the same attempt', r)
r = rpc('start_attempt', tok_b, p_form_id=FORM, p_name='Bob', p_email='bob@example.com')
attempt_b = r[1]['id'] if r[0] == 200 else None
check(attempt_b is not None and attempt_b != attempt_a, 'student B gets a different attempt', r)
r = rpc('start_attempt', tok_b, p_form_id=FORM, p_name='Bob', p_email='nope')
check(err_code(r) == '22023', 'invalid email is rejected', r)
r = rpc('start_attempt', tok_b, p_form_id='no-such-form', p_name='Bob', p_email='bob@example.com')
check(err_code(r) == 'P0001', 'a form that is not live is rejected', r)

# ---- 3. cross-student writes ----
ev = [{'seq': 1, 't': '2026-10-15T10:00:00Z', 'type': 'session_start'}]
r = rpc('log_events', tok_b, p_attempt_id=attempt_a, p_events=ev)
check(err_code(r) == '42501', "B cannot log events to A's attempt", r)
r = rpc('heartbeat', tok_b, p_attempt_id=attempt_a, p_status='active', p_strikes=0)
check(err_code(r) == '42501', "B cannot heartbeat A's attempt", r)
r = rpc('finish_attempt', tok_b, p_attempt_id=attempt_a, p_status='submitted')
check(err_code(r) == '42501', "B cannot finish A's attempt", r)

r = rpc('log_events', tok_a, p_attempt_id=attempt_a, p_events=ev)
check(r == (200, 1), 'A logs an event', r)
r = rpc('log_events', tok_a, p_attempt_id=attempt_a, p_events=ev)
check(r == (200, 0), 'a retried event is ignored', r)
big = [{'seq': 900, 't': '2026-10-15T10:00:00Z', 'type': 'paste', 'data': {'x': 'abcdef0123456789' * 200}}]
r = rpc('log_events', tok_a, p_attempt_id=attempt_a, p_events=big)
check(err_code(r) == '23514', 'an oversized event is rejected (23514)', r)
r = rpc('log_events', tok_a, p_attempt_id=attempt_a, p_events=[ev[0]] * 51)
check(err_code(r) == '22023', 'more than 50 events in a batch is rejected', r)

# ---- 4. teachers ----
status, body = call('POST', '/auth/v1/token?grant_type=password', body={'email': 'teacher@example.com', 'password': 'password123'})
tok_t1 = body.get('access_token') if status == 200 else None
check(tok_t1 is not None and claims(tok_t1).get('is_anonymous') is False, 'seed teacher can sign in', (status, body))
email2 = 'teacher-%s@example.com' % uuid.uuid4().hex[:8]
status, body = call('POST', '/auth/v1/signup', body={'email': email2, 'password': 'password123'})
check(status == 200 and not body.get('access_token'), 'sign-up needs email confirmation (no session yet)', (status, body))
status, body = call('POST', '/auth/v1/token?grant_type=password', body={'email': email2, 'password': 'password123'})
check(status == 400, 'an unconfirmed teacher cannot sign in', (status, body))
mailpit.confirm_signup(email2)
status, body = call('POST', '/auth/v1/token?grant_type=password', body={'email': email2, 'password': 'password123'})
tok_t2 = body.get('access_token') if status == 200 else None
check(tok_t2 is not None, 'a second teacher signs up, confirms by email and signs in', (status, body))

r = call('GET', '/rest/v1/attempts?select=id,student_name', tok_t1)
ids = {a['id'] for a in r[1]} if r[0] == 200 else set()
check({attempt_a, attempt_b} <= ids, 'teacher 1 sees both attempts', r)
r = call('GET', '/rest/v1/events?select=id&attempt_id=eq.' + str(attempt_a), tok_t1)
check(r[0] == 200 and len(r[1]) == 1, 'teacher 1 sees the events', r)
r = call('GET', '/rest/v1/attempts?select=id', tok_t2)
check(r == (200, []), 'teacher 2 sees no attempts', r)
r = call('GET', '/rest/v1/events?select=id', tok_t2)
check(r == (200, []), 'teacher 2 sees no events', r)
r = call('POST', '/rest/v1/commands', tok_t2, {'attempt_id': attempt_a, 'type': 'unlock'})
check(denied(r), "teacher 2 cannot unlock teacher 1's student", r)
r = call('PATCH', '/rest/v1/attempts?id=eq.' + str(attempt_a), tok_t1, {'strikes': 0})
check(denied(r), 'a teacher cannot edit attempts directly', r)
r = rpc('get_live_test', tok_t1, p_form_id=FORM)
check(r[0] == 200, 'teacher token can also call the RPCs', r)

# ---- 5. unlock is delivered once ----
r = rpc('heartbeat', tok_a, p_attempt_id=attempt_a, p_status='locked', p_strikes=3)
check(r[0] == 200 and r[1]['commands'] == [] and r[1]['status'] == 'locked', 'locked heartbeat with no command stays locked', r)
r = call('POST', '/rest/v1/commands', tok_t1, {'attempt_id': attempt_a, 'type': 'unlock'}, {'Prefer': 'return=minimal'})
check(r[0] == 201, 'teacher 1 sends an unlock', r)
r = rpc('heartbeat', tok_a, p_attempt_id=attempt_a, p_status='locked', p_strikes=3)
check(r[0] == 200 and [c['type'] for c in r[1]['commands']] == ['unlock'] and r[1]['status'] == 'active' and r[1]['strikes'] == 2,
      'next heartbeat returns one unlock; status active, strikes 2', r)
r = rpc('heartbeat', tok_a, p_attempt_id=attempt_a, p_status='active', p_strikes=2)
check(r[0] == 200 and r[1]['commands'] == [], 'the unlock is not delivered again', r)

# ---- 6. finishing ----
r = rpc('finish_attempt', tok_b, p_attempt_id=attempt_b, p_status='submitted')
check(r[0] in (200, 204), 'B submits', r)
r = rpc('log_events', tok_b, p_attempt_id=attempt_b, p_events=[{'seq': 901, 't': '2026-10-15T10:05:00Z', 'type': 'click'}])
check(err_code(r) == 'P0001', 'events after submit are rejected (P0001)', r)

# ---- 7. test lifecycle: go live (D7), end (D13), late submission ----
slug = 'iso-' + uuid.uuid4().hex[:8]
r = call('POST', '/rest/v1/tests', tok_t1, {'title': 'Isolation test', 'form_id': slug,
         'form_url': 'https://docs.google.com/forms/d/e/%s/viewform' % slug, 'settings': {}}, {'Prefer': 'return=representation'})
test_id = r[1][0]['id'] if r[0] == 201 else None
check(test_id is not None and r[1][0]['status'] == 'draft', 'teacher creates a draft test', r)
r = call('PATCH', '/rest/v1/tests?id=eq.' + str(test_id), tok_t1, {'status': 'live'})
check(denied(r), 'a teacher cannot set the status directly', r)
r = call('POST', '/rest/v1/tests', tok_t1, {'title': 'x', 'form_id': slug + 'b', 'form_url': 'u', 'status': 'live'})
check(denied(r), 'a teacher cannot insert a test that is already live', r)
r = call('GET', '/rest/v1/tests?select=id', tok_t2)
check(r == (200, []), "teacher 2 cannot see teacher 1's tests", r)
r = rpc('go_live', None, p_test_id=test_id, p_one_response=True, p_verified_email=True)
check(denied(r), 'no session cannot go live', r)
r = rpc('go_live', tok_a, p_test_id=test_id, p_one_response=True, p_verified_email=True)
check(err_code(r) == '42501', 'a student cannot go live', r)
r = rpc('go_live', tok_t2, p_test_id=test_id, p_one_response=True, p_verified_email=True)
check(err_code(r) == '42501', "teacher 2 cannot take teacher 1's test live", r)
r = rpc('go_live', tok_t1, p_test_id=test_id, p_one_response=True, p_verified_email=False)
check(err_code(r) == '22023', 'go live is refused unless both D7 boxes are ticked', r)
r = rpc('go_live', tok_t1, p_test_id=test_id, p_one_response=True, p_verified_email=True)
check(r[0] == 200 and r[1]['status'] == 'live' and r[1]['attested_at'], 'go live with both boxes ticked records the attestation', r)
r = call('PATCH', '/rest/v1/tests?id=eq.' + str(test_id), tok_t1, {'title': 'edited'}, {'Prefer': 'return=representation'})
check(r == (200, []), 'a live test can no longer be edited', r)

r = rpc('start_attempt', tok_a, p_form_id=slug, p_name='Ann', p_email='ann@example.com')
att = r[1]['id'] if r[0] == 200 else None
check(att is not None, 'a student can start an attempt on the newly live test', r)
r = rpc('end_test', tok_a, p_test_id=test_id)
check(err_code(r) == '42501', 'a student cannot end a test', r)
r = rpc('end_test', tok_t2, p_test_id=test_id)
check(err_code(r) == '42501', "teacher 2 cannot end teacher 1's test", r)
r = rpc('end_test', tok_t1, p_test_id=test_id)
check(r == (200, {'closed': 1}), 'End closes the unfinished attempts and reports how many', r)
r = rpc('end_test', tok_t1, p_test_id=test_id)
check(err_code(r) == 'P0001', 'a test can be ended only once', r)
r = rpc('get_live_test', tok_a, p_form_id=slug)
check(r[0] == 200 and r[1] == [], 'new visitors are no longer protected after End', r)
r = rpc('heartbeat', tok_a, p_attempt_id=att, p_status='active', p_strikes=0)
check(r[0] == 200 and r[1]['closed'] is True, 'the next heartbeat carries closed=true', r)
r = rpc('finish_attempt', tok_a, p_attempt_id=att, p_status='submitted')
r = rpc('finish_attempt', tok_a, p_attempt_id=att, p_status='submitted')
r = call('GET', '/rest/v1/events?select=type&type=eq.submitted_after_close&attempt_id=eq.' + str(att), tok_t1)
check(r[0] == 200 and len(r[1]) == 1, 'a submission after End is flagged submitted_after_close, once', r)
r = call('DELETE', '/rest/v1/tests?id=eq.' + str(test_id), tok_t2, extra={'Prefer': 'return=representation'})
check(r == (200, []), "teacher 2 cannot delete teacher 1's test", r)
r = call('DELETE', '/rest/v1/tests?id=eq.' + str(test_id), tok_t1, extra={'Prefer': 'return=representation'})
check(r[0] == 200 and len(r[1]) == 1, 'teacher 1 can delete their test and its data (D14)', r)

print()
print('ALL PASS' if not failures else '%d FAILED' % failures)
sys.exit(1 if failures else 0)
