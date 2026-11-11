# Switch on Glidepath accounts (Cloudflare, free)

Sign-up, sign-in, flight sync across devices and saved PCs run on Cloudflare's
free plan (Workers + D1). No card is needed. You only do this once, and you
never paste a secret into a chat: it goes straight into GitHub.

## 1. Cloudflare account (2 minutes)

1. Go to https://dash.cloudflare.com/sign-up and create a free account.
2. In the left menu open **Workers & Pages**. If it asks you to pick a
   *workers.dev subdomain*, choose any name (for example `glidepath`).
3. Copy your **Account ID**: it's on the right-hand side of the Workers & Pages
   overview (or in the address bar: `dash.cloudflare.com/<ACCOUNT ID>/...`).

## 2. API token (1 minute)

1. Open https://dash.cloudflare.com/profile/api-tokens and click **Create Token**.
2. Use the **Edit Cloudflare Workers** template.
3. Under **Permissions**, click **+ Add more** and add **Account → D1 → Edit**.
4. **Continue to summary → Create Token**, and copy the token. (You'll only see it once.)

## 3. Give them to GitHub (1 minute)

1. Open https://github.com/etihadairways1028-beep/glidepath/settings/secrets/actions
2. **New repository secret**: name `CLOUDFLARE_API_TOKEN`, value: the token.
3. **New repository secret**: name `CLOUDFLARE_ACCOUNT_ID`, value: the Account ID.

## 4. Deploy (1 click)

Open https://github.com/etihadairways1028-beep/glidepath/actions/workflows/accounts.yml
and click **Run workflow**. In about a minute it:

- creates the `glidepath` database and its tables,
- deploys the accounts service to `https://glidepath-accounts.<your-subdomain>.workers.dev`,
- publishes `cloud.json` on the website, which switches sign-in on in the
  website and the app automatically.

## Optional: monthly email brief

Accounts work without this. To send the monthly brief, make a free
https://www.brevo.com account, verify a sender email, create an API key, and
add two more repository secrets: `BREVO_API_KEY` and `BREVO_SENDER_EMAIL`.
Then run the workflow again.

## What's stored

Email, display name, a salted and peppered PBKDF2 hash of the password (never
the password), your flight summaries (no live telemetry), and the PCs you've
paired. Deleting your account in the app removes all of it.


