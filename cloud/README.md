# Switching on Glidepath accounts (about 15 minutes, all free)

This turns on: sign-in (many accounts per device), login before download, your
logbook on every device, devices finding your PC by themselves, and the monthly
email. Until it's done, everything else keeps working and the download stays open.

You need two free accounts: **Supabase** (sign-in and database) and **Brevo** (email).

## 1. Supabase project
1. Go to supabase.com, sign in with GitHub, click **New project**.
   Name it `glidepath`, pick the region closest to you, set a database password (keep it safe).
2. **SQL Editor → New query**: paste all of `cloud/setup.sql`, click **Run**.
3. **Authentication → URL Configuration**
   - Site URL: `https://etihadairways1028-beep.github.io/glidepath/`
   - Redirect URLs: add `https://etihadairways1028-beep.github.io/glidepath/**`
4. **Storage → releases** (the bucket the SQL created): upload
   `GlidepathBridge-windows-x64.zip` (download it from the website first).

## 2. Brevo (email)
1. Go to brevo.com, create a free account.
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: use your own email
   (for example your Gmail) and confirm it from the email Brevo sends you.
3. **SMTP & API → API keys → Generate a new API key**. Copy it.
4. Still under **SMTP & API → SMTP**: note the SMTP login and generate an SMTP key (for step 4 below).

## 3. The two functions
In Supabase: **Edge Functions → Deploy a new function → Via editor**.
1. Name `download`. Delete the sample code, paste all of `cloud/functions/download/index.ts`, **Deploy**.
2. **Edge Functions → Secrets → Add**:
   - `BREVO_API_KEY` = the Brevo API key
   - `BREVO_SENDER_EMAIL` = the sender email you confirmed in Brevo
   - `CRON_SECRET` = any long random string you make up (letters and numbers, 30+ characters)
   - `APP_URL` = `https://etihadairways1028-beep.github.io/glidepath/app/`
3. New function, name `monthly-brief`, paste all of `cloud/functions/monthly-brief/index.ts`.
   Open its **Settings** and turn **off** "Enforce JWT verification" (the monthly
   schedule uses the CRON_SECRET instead; the function checks sign-in itself). **Deploy**.
4. **SQL Editor**: open `cloud/schedule.sql`, replace `YOUR-PROJECT-REF` (from your
   project URL, `https://<ref>.supabase.co`) and `YOUR-CRON-SECRET`, then **Run**.

## 4. Sign-up emails through Brevo (recommended)
Supabase's built-in email only sends a few messages an hour. In **Authentication →
Emails → SMTP Settings**, turn on custom SMTP: host `smtp-relay.brevo.com`, port `587`,
your Brevo SMTP login and SMTP key, sender = your confirmed Brevo sender.

## 5. Send these two things to Claude
From **Project Settings → API Keys** (or **Data API**):
- the **Project URL** (`https://<ref>.supabase.co`)
- the **publishable key** (starts `sb_publishable_`, or the older `anon` key)

Both are meant to be public; the database rules in `setup.sql` protect each person's data.
**Never share** the secret / service_role key, the database password, the Brevo keys or the CRON_SECRET.

Claude then publishes `cloud.json` with those two values and removes the public download,
so the website asks people to sign in before downloading.

## Checking it works
- Website → **Sign in** → create an account → **Download for Windows** gives you the zip.
- App → **Account** → **Email me this month so far** sends a preview (needs at least one finished flight this month).
