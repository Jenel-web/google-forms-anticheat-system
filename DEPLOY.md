# Deploying CheatNoNo for a real test

Three pieces: a hosted **Supabase** project (database + accounts), the **teacher dashboard** on a static host, and the **extension folder** you hand to students. Nobody but you runs any commands.

## 0. What you need
- Your Supabase project (free tier is fine).
- Node.js and the Supabase CLI on your own PC (you already have both).
- A free Netlify or Cloudflare Pages account for the dashboard.

## 1. Supabase project (once)

1. **Get the two public values.** Supabase dashboard -> Project Settings -> API: copy the **Project URL** (`https://<ref>.supabase.co`) and the **anon / publishable key**. Both are public by design. **Never** use the `service_role` / secret key anywhere in this project.
2. **Apply the database.** From the repo root:
   ```bash
   supabase login
   supabase link --project-ref <ref>        # asks for the database password you set when creating the project
   supabase db push                         # applies supabase/migrations/*.sql
   ```
   Do **not** run `supabase db reset` against the hosted project, and don't load `supabase/seed.sql` there: it creates a demo teacher with a known password.
3. **Auth settings** (Authentication in the Supabase dashboard):
   - Sign In / Providers -> turn on **Allow anonymous sign-ins** (students are anonymous users; without this nothing works).
   - Sign In / Providers -> Email: keep **Confirm email** on.
   - URL Configuration -> **Site URL** = your dashboard address from step 2 (for example `https://cheatnono.netlify.app`). Add the same address under Redirect URLs. You can do this after step 2.
4. **Confirmation emails.** Supabase's built-in email sender is heavily limited and (on current projects) only delivers to people who are members of your Supabase organization. Pick one:
   - Invite your professor to your Supabase organization (Organization -> Team) so their sign-up email arrives, or
   - set a custom SMTP sender (Authentication -> Emails -> SMTP Settings, for example Resend or Brevo), the cleanest option, or
   - as a last resort for a closed class, turn Confirm email off. Anyone who finds the dashboard link could then create a teacher account, so only do this knowingly.
5. **Realtime.** The migration already adds `attempts` and `events` to the realtime publication. Check Database -> Publications -> `supabase_realtime` lists them.

## 2. Teacher dashboard

1. Copy `dashboard/.env.example` to `dashboard/.env.production` (the leading dot matters) and fill in the two values from Supabase step 1.
2. Build:
   ```bash
   npm --prefix dashboard install
   npm --prefix dashboard run build        # output: dashboard/dist
   ```
3. Upload `dashboard/dist`:
   - **Netlify:** app.netlify.com/drop, drag the `dist` folder in. You get an `https://...netlify.app` address (rename it under Site settings if you like).
   - **Cloudflare Pages:** create a project with "Upload assets" and upload the `dist` folder.
- **Vercel:** deploy the already-built folder, so Vercel never has to build the project (the dashboard imports shared code from sibling folders, which a Vercel build with root `dashboard/` would not see):
  ```bash
  cd dashboard/dist
  npx vercel --prod
  ```
  Log in when asked, accept the defaults (no framework, no build command), and you get an `https://….vercel.app` address. `dist/vercel.json` (copied from `dashboard/public/`) makes refreshes and email links work. To update later, rebuild and run the same command again.

`dist/_redirects` (Netlify, Cloudflare) and `dist/vercel.json` (Vercel) are copied from `dashboard/public/` and make page refreshes and email links work. Then go back to Supabase step 3 and set the Site URL to this address.

## 3. The extension for students

1. Copy `extension/.env.example` to `extension/.env.production` and fill in the same two values (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
2. Build:
   ```bash
   npm --prefix extension install
   npm --prefix extension run build
   ```
   The last line must say `for https://<ref>.supabase.co`. If it says `(local stack)` the env file was not found or has the wrong name. The build refuses a secret key and a malformed URL.
3. Zip the **contents of `extension/dist`** (the folder where `manifest.json` sits directly) and share the zip. Rebuild and re-share whenever you change the URL, key or code.

`.env.production` files are git-ignored; only the `.env.example` templates are committed.

## 4. Student install (about 1 minute)

1. Unzip the file somewhere permanent (Documents is fine). **Do not move or delete the folder** afterwards.
2. In Chrome open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder, the one that contains `manifest.json`.
4. On the extension's card, click **Details** and turn on **Allow in incognito** (D9).
5. Open the exam link. The consent screen asks for name and email.

Chrome may show a "disable developer mode extensions" notice when it starts. Students should dismiss it, not disable the extension.

## 5. Teacher flow (your professor)

1. Open the dashboard address, **Create an account**, confirm the email, sign in.
2. In Google Forms: Settings -> Responses -> turn on **Limit to 1 response** and **Collect email addresses: Verified**.
3. Copy the form's **Send -> link** (the published link, `.../forms/d/e/.../viewform`, **not** the edit link).
4. In the dashboard: **Add test**, paste the link, set a title and settings, **Go live** (tick both Forms checkboxes).
5. Send students the same Google Form link. During the exam use the live monitor and **Unlock**.
6. Afterwards: in Google Forms turn off **Accepting responses**, then **End test**. Open **Report**, and use **Choose responses CSV** with the Forms responses file to find submissions that were not monitored.

## 6. Dry run before the real exam (do this)

- Use two different computers (or two Chrome profiles): one professor, one student.
- Check: consent screen appears, the monitor shows the student within seconds, a tab switch gives a strike, Unlock works, the report and timeline show the data.
- Open the dashboard the day before. **Free Supabase projects pause after about 7 days idle**; open the project in the Supabase dashboard to resume it.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Student sees nothing on the form | Loaded the wrong folder (not `dist`), built without the hosted URL, or opened the edit link / a different form link. |
| "Server unreachable" on the consent screen | Wrong URL or key in the build, or the project is paused. |
| Teacher never gets the confirmation email | Built-in email limit; see Supabase step 4. |
| Email link opens the wrong site | Site URL in Supabase Auth is still `127.0.0.1`. |
| Dashboard shows a blank page on refresh | `_redirects` missing from the upload. |
| Student can't start: auth error | Anonymous sign-ins are off. |
