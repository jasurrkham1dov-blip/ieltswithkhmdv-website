# IELTS with KHMDV — Mock Test Website

Your own site for Reading & Listening practice tests and **Sunday mock exams**.

- Students create an account and log in
- **Practice tests** — instant score, band and answer review
- **Sunday mocks** — open at a set time, need a password, timer can't be paused, auto-submit when time runs out, results go to **your Telegram channel** (students don't see scores until you release them)
- **Admin panel** — paste passage, questions and answer key → the test is built for you
- Answer keys stay on the server, so students can't find them in the page source

---

## 0. Try it first (demo mode)

With empty keys in `js/config.js`, the site runs in **demo mode** — everything is stored in your browser.
Demo accounts: `teacher@demo.uz` / `demo123` (admin) and `student@demo.uz` / `demo123`. Sample mock password: `sunday`.

> The site must be opened through a web address (GitHub Pages, or `python -m http.server` on your computer), not by double-clicking `index.html`.

---

## 1. Create the database (Supabase, free)

1. Go to **supabase.com** → sign up → **New project**. Region: *Central EU (Frankfurt)* is closest. Save the database password somewhere.
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, click **Run**.
3. **Authentication → Sign In / Providers → Email**: keep Email on. If you don't want students to confirm their email, turn **Confirm email** off.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

## 2. Telegram results channel

1. In Telegram, open **@BotFather** → `/newbot` → copy the **bot token**.
   (You can reuse a bot, but a separate one keeps mock results apart from your IceBerg exams.)
2. Create a **private channel** (e.g. "Sunday Mock Results") → add the bot as **admin** with "Post messages".
3. Post any message in the channel, then open in a browser:
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   Find `"chat":{"id":-100…` — that number (with the minus) is your **chat ID**.

## 3. Add the two server functions (no installs needed)

In Supabase open **Edge Functions → Deploy a new function → Via Editor**, then for each of the two files in `supabase/paste-in-dashboard/`:

1. Name the function exactly **`start-mock`** (then the second one **`submit-attempt`**).
2. Delete the sample code, paste the whole file, click **Deploy function**.

Then **Edge Functions → Secrets** → add two secrets:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | your bot token from BotFather |
| `TELEGRAM_CHAT_ID` | your channel ID, e.g. `-1001234567890` |

(Prefer the terminal? `npx supabase functions deploy start-mock --use-api` from this folder works too, using `supabase/functions/`.)

## 4. Connect the website

Open `js/config.js` and paste your keys:

```js
SUPABASE_URL: 'https://abcdxyz.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...',
```

The anon key is meant to be public — the database security rules protect the data.

## 5. Put the site online (GitHub Pages, free)

1. GitHub → **New repository** (e.g. `ielts-mock`, Public) → **Add file → Upload files** → drag in everything from this folder (keep the folders) → Commit.
2. Repository **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)` → Save.
3. After a minute your site is at `https://<your-username>.github.io/ielts-mock/`.
4. Back in Supabase: **Authentication → URL Configuration** → set **Site URL** to that address (needed for confirmation and password-reset emails).

## 6. Make yourself the admin

Sign up on your site with your own email, then in Supabase **SQL Editor** run:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'YOUR-EMAIL@gmail.com');
```

Reload the site — an **Admin** tab appears.

---

## Test library

The `library` folder holds all the HTML tests you've already made (212 of them, with duplicate copies removed). They appear on the **Library** page, sorted by type and level, with search.

- **Add a new test:** Admin → **Library uploads** → choose the HTML file → Upload. It goes to the top of the library straight away. (Run the latest `schema.sql` once first, since it adds the uploads table.)
- **Rename or move a built-in test:** edit its line in `library/catalog.json`.
- **Big files:** the six full mock exams are about 30 MB each. GitHub's website only accepts files up to 25 MB, so upload the site with **GitHub Desktop** (free, desktop.github.com) instead of drag-and-drop. It handles files up to 100 MB.

## Weekly routine

1. **Admin → + Reading test / + Listening test** — paste the text, add question groups, paste the answer key. The **Check** box tells you if any question is missing an answer. Click **Preview as student** to try it.
2. Set tests for the mock to **"Mock only"** so nobody sees them early.
3. **Sunday mocks → New** — pick opening/closing time, the sections in order (e.g. Listening then Reading) and a password.
4. On Sunday, post the password in your Premium Channel. Each student's result arrives in your Telegram channel when they finish.
5. **Results** page → see every student, wrong question numbers, export CSV, then **Release results** when you're ready.
6. After the mock you can switch those tests to **Practice** so students can review them.

## Writing tests — cheat sheet

| Where | Write |
|---|---|
| Passage | `# Title`, blank line between paragraphs, `[A]` at the start for lettered paragraphs, `**bold**` |
| TFNG / YNNG | one statement per line |
| Multiple choice | question line, then `A …`, `B …`; empty line between questions |
| Choose TWO | question line + options, set **Choose = 2** |
| Matching | items one per line; choices in **Options** (`A`, `B`… or `i  heading text`) |
| Completion | text with `[[5]]` where answer 5 goes; `- ` bullets; `\| a \| b \|` table rows; optional word bank |
| Map / diagram | any group → **Picture** → image URL (e.g. GitHub raw link) |
| Answer key | `1 TRUE` · `5 coffee / coffees` · `6 (the) river` · `11-12 B, D` |

Listening audio: paste a link (your GitHub raw MP3 links work) or click **Upload MP3**. Tick **Exam mode audio** to make it play once with no pause.

## Files

```
index.html            the website
css/style.css         design
js/config.js          ← your keys go here
js/app.js             pages: login, dashboard, test player, admin
js/render.js          turns your pasted text into questions
js/scoring.js         marking + band conversion (copy also in supabase/functions/_shared)
js/backend.js         talks to Supabase (or the demo storage)
js/demo-data.js       sample tests for demo mode
supabase/schema.sql   database tables + security rules
supabase/functions/   start-mock, submit-attempt (server-side marking + Telegram)
```
