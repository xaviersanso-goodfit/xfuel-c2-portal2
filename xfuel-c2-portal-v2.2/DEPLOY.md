# Deploying the C2 portal

## Already set up? Shipping a new version (no terminal)

The zip contains a Next.js application. The folders inside it **are** the app,
not packaging: `src/` is the code, `supabase/` the database schema, `scripts/`
the test harness, `public/` static assets. They keep their positions relative to
each other, so the whole tree goes into the repo exactly as it is.

1. **Unzip.** Double-click `xfuel-c2-portal.zip`. You get a folder with
   `package.json`, `next.config.mjs`, `src/` and the rest inside it.
2. **Open the repo**: `https://github.com/xaviersanso-goodfit/Xfuel-FPA-portal`
3. **Add file → Upload files.**
4. Open the unzipped folder, press **Cmd+A** to select everything *inside* it,
   and drag the selection onto the drop zone. Drag the **contents**, not the
   folder itself: dropping the folder nests everything one level deeper and the
   build will not find `package.json`.
5. Wait for the file list to finish populating, then **Commit changes**.

Vercel is already connected to this repo and builds on every commit, so that is
the deployment. Watch it at `https://vercel.com/dashboard` under the
`fpa-portal-xfuel` project. A couple of minutes.

Two notes:

- Finder hides dotfiles, so `.gitignore` and `.env.example` probably will not
  come across. Neither affects the build. Press **Cmd+Shift+.** before selecting
  if you want them.
- Uploading over an existing repo overwrites files with the same path and adds
  new ones; it deletes nothing. That is fine here because this version only adds
  files relative to the last upload.

Nothing else is needed. The environment variables and the database are already
configured, and the schema has not changed.

---

## First-time setup

The rest of this file is the original end-to-end guide, kept for reference: what
to do if the Supabase project or the Vercel project ever has to be rebuilt from
scratch. Skip it if the portal is already live.

Written for someone who has not deployed a web app before. Budget about 30 minutes. Everything here is free at this scale (Supabase free tier, Vercel Hobby plan).

There are two services and they do different jobs:

- **Supabase** is the database and the login system. It stores your scenarios and decides who may edit them.
- **Vercel** hosts the website itself and gives you the URL people visit.

They need to know about each other. That connection is the "two environment variables" — see step 3.

---

## Before you start

You need three things installed on your Mac. Open **Terminal** (Cmd+Space, type "Terminal") and check:

```bash
node -v
```

If that prints a version number like `v20.x` or `v22.x`, you are fine. If it says "command not found", install Node from https://nodejs.org (take the LTS version, click through the installer, then close and reopen Terminal).

You also need accounts at:

- https://supabase.com (sign up free, GitHub or email)
- https://vercel.com (sign up free)

---

## Step 1 — Create the Supabase project

1. Go to https://supabase.com/dashboard and click **New project**.
2. Fill in:
   - **Name**: `xfuel-c2-portal`
   - **Database Password**: click Generate, then **copy it somewhere safe**. You will probably never need it, but it cannot be recovered later.
   - **Region**: pick the one closest to your users, e.g. `West EU (Ireland)` or `Central EU (Frankfurt)`.
3. Click **Create new project**. It takes a minute or two to provision. Wait for the spinner to finish.

## Step 2 — Create the database tables

1. In the left sidebar of your Supabase project, click **SQL Editor**.
2. Click **New query**.
3. Open the file `supabase/schema.sql` from this project folder in any text editor, select all, copy.
4. Paste it into the Supabase SQL editor.
5. Click **Run** (bottom right, or Cmd+Enter).

You should see "Success. No rows returned." That is the correct result — it created tables rather than fetching data.

To confirm: click **Table Editor** in the sidebar. You should now see three tables: `profiles`, `scenarios`, `commentary`.

## Step 3 — Get the two connection values

This is what "the two environment variables" means. They are two pieces of text that tell the website which database to talk to. Think of them as an address and a key.

1. In Supabase, click the **gear icon (Project Settings)** in the sidebar.
2. Click **API** (in newer dashboards this may be **API Keys** or **Data API**).
3. You need two values from this page:

   | What you copy | Looks like | Becomes |
   |---|---|---|
   | **Project URL** | `https://abcdefgh.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL` |
   | **anon / public** key | a very long string starting `eyJ...` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

4. Copy both into a scratch note for the next step.

**Important:** copy the key labelled **anon** or **public**. Do **not** use the one labelled `service_role` or `secret` — that one bypasses all security and must never go into a website. The anon key is designed to be public; your data is protected by the security rules you installed in step 2, not by hiding this key.

## Step 4 — Test it locally first

Worth doing: if something is wrong, you find out here rather than after deploying.

In Terminal:

```bash
cd "/Users/xaviersanso/Documents/Claude/Projects/Ignion/xfuel-c2-portal"
npm install
cp .env.example .env.local
open -e .env.local
```

That last command opens a small text file in TextEdit. Replace the placeholder values with the two you copied, so it looks like:

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....
```

No quotes, no spaces around the `=`. Save and close.

Then:

```bash
npm run dev
```

Open http://localhost:3000 in your browser. You should see the sign-in screen. Create an account with your email, then continue to step 5 to make yourself an editor.

Press `Ctrl+C` in Terminal to stop the local server when you are done.

## Step 5 — Make yourself an editor

Everyone who signs up starts as read-only. That is deliberate. To promote yourself:

1. In Supabase, go to **SQL Editor** → **New query**.
2. Run this, with your own email:

   ```sql
   update public.profiles set role = 'editor' where email = 'xavier.sanso@metrixpartners.com';
   ```

3. Sign out and back in to the portal. The badge top right should now say **editor** and the input fields become editable.

To add the rest of the team later: they sign up themselves, then you run the same statement with their email (or leave them as viewers, which is the point of the read-only role).

## Step 6 — Put the code on GitHub

Vercel deploys from a Git repository. This also gives you version history and automatic redeploys.

1. Go to https://github.com/new
2. Repository name: `xfuel-c2-portal`. Set it to **Private**. Do **not** tick "Add a README". Click **Create repository**.
3. GitHub then shows you a page of commands. Ignore it and use these instead, in Terminal:

   ```bash
   cd "/Users/xaviersanso/Documents/Claude/Projects/Ignion/xfuel-c2-portal"
   git init
   git add .
   git commit -m "XFuel C2 portal"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/xfuel-c2-portal.git
   git push -u origin main
   ```

   Replace `YOUR-USERNAME` with your GitHub username. If it asks for a password, GitHub wants a personal access token rather than your password — easiest fix is to install GitHub Desktop (https://desktop.github.com) and publish the folder from there instead.

The `.gitignore` file already excludes `node_modules` and `.env.local`, so your keys do not get uploaded.

## Step 7 — Deploy on Vercel

1. Go to https://vercel.com/new
2. Click **Import Git Repository**, connect your GitHub account if prompted, and pick `xfuel-c2-portal`.
3. Vercel detects Next.js automatically. Leave the build settings alone.
4. Before clicking Deploy, expand **Environment Variables** and add the two values from step 3:

   - Name: `NEXT_PUBLIC_SUPABASE_URL` — Value: your project URL
   - Name: `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Value: your anon key

   Add each one, then click Add again for the second. Leave them applied to all environments (Production, Preview, Development).

5. Click **Deploy**. It takes a couple of minutes.

You get a URL like `https://xfuel-c2-portal.vercel.app`. That is the live portal.

**If you forget the environment variables**, the site still loads but runs in local-storage mode with a yellow banner saying there is no backend. Add them under **Settings → Environment Variables**, then go to **Deployments**, click the most recent one, and choose **Redeploy** — environment variables only take effect on a new build.

## Step 8 — Tell Supabase the site's address

So that sign-in redirects work from the real URL rather than localhost:

1. In Supabase, go to **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel URL, e.g. `https://xfuel-c2-portal.vercel.app`.
3. Under **Redirect URLs**, add the same URL, and `http://localhost:3000` if you want local development to keep working.
4. Save.

While you are in **Authentication**, check **Providers → Email**. If **Confirm email** is on, new users must click a link in their inbox before they can sign in. For a small internal team you may prefer to switch it off so people can sign in immediately.

---

## Verify it actually works

Do not skip this. In particular the read-only role has not been tested against a live database, only in the interface.

1. **Editor can save.** Sign in as yourself, change a number on the Global parameters tab, click **Save**. Reload the page. The change should still be there — that proves it saved to Supabase and not just your browser.
2. **Two devices see the same data.** Open the URL on your phone, sign in, check the number matches. This is the thing the Ignion portal could not do.
3. **Viewer cannot edit.** Sign up a second account (a personal email works), leave it as viewer, sign in. Every field should be greyed out and there should be no Save button.
4. **Viewer is blocked at the database, not just the screen.** This is the real test of the security rules. With the viewer account signed in, open the browser console (Cmd+Option+J in Chrome) and run:

   ```js
   const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
   // paste your own URL and anon key here
   const sb = createClient('https://abcdefgh.supabase.co', 'eyJ...');
   console.log(await sb.from('scenarios').update({ name: 'hacked' }).eq('is_base', true));
   ```

   You want this to fail or affect zero rows. If it succeeds, the row-level security policies did not install correctly — re-run `supabase/schema.sql`.

---

## Day-to-day afterwards

- **Changing the code**: edit, then `git add . && git commit -m "what changed" && git push`. Vercel redeploys automatically within a minute or two.
- **Custom domain** (e.g. `c2.xfuel.com`): Vercel → your project → **Settings → Domains** → add the domain, then create the DNS record Vercel shows you at whoever hosts xfuel.com. Remember to update the Site URL in Supabase (step 8) afterwards.
- **Backups**: Supabase free tier keeps daily backups for 7 days. For anything you care about, also use **Download model (.xlsx)** from the Scenarios tab and keep the file.

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Yellow "running without a backend" banner | Environment variables missing or misspelled | Check names are exactly as written, then redeploy |
| "Invalid API key" | Wrong key copied, or the `service_role` key used | Copy the **anon/public** key again |
| Sign-in email never arrives | Supabase's built-in mail is rate-limited | Turn off Confirm email, or configure your own SMTP under Authentication → Emails |
| Signed in but everything is greyed out | Your profile is still `viewer` | Run the promote SQL in step 5, then sign out and in |
| Build fails on Vercel | Usually a missing dependency | Open the build log; if stuck, run `npm run build` locally to see the same error |
