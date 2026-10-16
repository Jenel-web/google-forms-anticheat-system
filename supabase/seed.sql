-- Local dev seed: one teacher and one live test. Never run this against a hosted project.
-- Teacher login: teacher@example.com / password123

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values (
  '00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'teacher@example.com', crypt('password123', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"teacher@example.com","email_verified":true}',
  'email', now(), now(), now()
);

insert into public.tests (id, owner_id, title, form_id, form_url, status, settings)
values (
  '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
  'Local dev exam', 'seed-form-id-local-dev',
  'https://docs.google.com/forms/d/e/seed-form-id-local-dev/viewform', 'live',
  '{"mode":"enforce","maxStrikes":3,"allowlist":[]}'
);
