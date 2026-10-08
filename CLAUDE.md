# Bountiful — guide for any Claude (read this first)

Bountiful is a web app for the custodians (and receptionists) of an LDS temple. The owner is **not a coder**: explain things in plain words, keep answers short, and do the work for them. Style: minimalist, airy, very round corners, **only Tabler FILLED icons**, Lexend font, mint-based pastel palette.

- Live site: https://limisan98.github.io/bountiful/ (GitHub Pages, repo `limisan98/bountiful`, branch `main`, deploys ~1–2 min after `git push origin main`)
- Database/Auth: Supabase project `kmlvdgtxafcdbsosrsqx` (`https://kmlvdgtxafcdbsosrsqx.supabase.co`). The publishable key in `src/config.js` is public by design. **Never** put a secret/service_role key in the repo.
- Languages: English (default), German, Spanish, Portuguese, Dutch, Swedish. Every user-visible text goes through `t('key')` and must exist in **all six** files in `src/locales/`.
- Palette: mint `#86E3CE` (brand), lime `#D0E6A5`, yellow `#FFDD94`, coral `#FA897B`, lavender `#CCABD8`. Tokens are CSS variables at the top of `assets/app.css`.

## Architecture in one minute
Static site, **no build step**. Vanilla ES modules + Preact/htm (`assets/vendor/htm-preact.js`; exports `html, render, Component, createContext, useState, useReducer, useEffect, useLayoutEffect, useRef, useImperativeHandle, useMemo, useCallback, useContext, useErrorBoundary` — no Fragment/useId/portals). supabase-js is vendored (`assets/vendor/supabase.js`). Edit a file, push, done.

Data flow: `src/api.js` (all Supabase calls, plus `subscribe` for Realtime) → `src/data.js` (loads everything into the store, exposes mutations like `addRooms`, listens to live changes) → `src/store.js` (tiny global state + `useStore()` + `toast()`) → views in `src/views/`.
**Demo mode:** `?demo=custodian_supervisor|custodian|receptionist` runs the whole app on fake data from `src/demo.js` (nothing saved). Every new feature needs a matching method in the demo API too, otherwise demo falls through to the real API and fails.

## Where is what
| Thing | File |
|---|---|
| Entry, routing, navigation (`NAV` list), demo banner | `src/app.js` (routes are hash routes `#/home|calendar|rooms|chat|team|tasks|reports|meetings|shifts`) |
| Supabase URL/key, role defaults (`ROLE_DEFAULTS`, `ROLE_ORDER`), icon lists | `src/config.js` |
| Roles helpers (`isSupervisor`, `departmentOf`, `roleInfo`) | `src/roles.js` |
| All DB calls | `src/api.js` (+ demo twin in `src/demo.js`) |
| State + mutations + realtime handling | `src/store.js`, `src/data.js` |
| Notifications (types, preferences, what triggers one) | `src/notify.js`, settings sheet `src/views/notifications.js` |
| Translations | `src/locales/{en,de,es,pt,nl,sv}.js`, loader `src/i18n.js` |
| UI pieces (Icon, Avatar, Sheet, Field, Segmented, Empty, PersonLine, RoleChip…) | `src/ui.js` |
| App-styled date/time pickers (`DateField`, `TimeField`; year only shown in the popup) | `src/pickers.js` |
| @mention dropdown for chat | `src/mentions.js` |
| Dates helpers (`ymd`, `parseYmd`, `addDays`, `fmt`, `hhmm`, `todayYmd`) | `src/time.js` |
| Colors from a hex (`colorVars/colorStyle`; careful: `colorStyle` sets `--ink`) | `src/color.js` |
| Avatar image cropping | `src/image.js` |
| Logo component | `src/logo.js`; files in `assets/logo/` |
| Icons (Tabler filled SVG paths, bundled) | `assets/icons.js` — the curated set drawn inline |
| Full Tabler library (filled + outline, ~5,000) for the icon picker search | `src/iconlib.js`: loaded lazily from the jsDelivr CDN (version pinned). Outline icons are stored in the DB as `outline--name` (DB only allows a-z0-9-). `Icon` in `src/ui.js` draws non-bundled names as CSS masks from the CDN |
| Flags for the language menu | `assets/flags.js` |
| All CSS | `assets/app.css` (one file; sections are commented) |
| PWA (install + notification display) | `sw.js`, `manifest.webmanifest` |
| Database scripts, in the order they were run | `supabase/001…009_*.sql` |

Screens (`src/views/`): `home.js` (tiles), `calendar.js` (day/week of assignments), `tasks.js` (task library, supervisor edits), `assign.js` (plan a task for someone), `chat.js` (chat list + conversations; mentions; long-press copy/delete; task invitations), `person.js` (profile card + "Send message"), `invites.js` (invitation card/sheet), `rooms.js` (rooms to clean), `reports.js` (automatic reports), `meetings.js`, `team.js` (people, allowlist, roles), `profile.js`, `notifications.js`, `auth.js` (sign in / create account).

## Roles and the chain of work
Three roles: `custodian_supervisor` (the only supervisor; department custodian), `custodian`, `receptionist` (department reception). There is no reception supervisor.
- Only supervisors assign tasks. Custodians can *invite* a colleague to take over one of their tasks from the chat (button in composer): only the invited person accepts/declines, everyone sees Pending/Accepted/Declined, sender can cancel.
- **Rooms:** Receptionist lists rooms for a day (and can edit/delete their own requests) → Custodian Supervisor gives them to a custodian → custodian marks Start/Done. The Rooms screen has a day-card strip (`DayOverview` in `src/views/rooms.js`): receptionists see their own requests, custodians the rooms given to them, the supervisor every day with who cleans how many; it opens on the nearest day that has rooms. Supervisors are notified of new/edited requests, custodians of rooms given to them (a row that newly becomes visible has no previous state in the store, so notify.js treats `!prev` as new).
- **Chat:** only the custodian team (custodians + supervisor; receptionists have no chat). One `general` chat plus 1:1 DMs (channel `dm:<smaller id>:<bigger id>`), shown as a WhatsApp-style list (side by side with the conversation on wide screens). Long-press (or right-click) a message to copy/delete. Tapping a person's picture anywhere (any element with `data-pid`, not inside a button) opens their profile card (`PersonSheet`) with a Message button. Unread counters live in localStorage (`bountiful.chatSeen`). RLS uses `can_chat(channel)` (supabase/009).
- **Meetings:** anyone who is not a supervisor asks the supervisor for a meeting (day, time, topic); supervisor accepts or declines (optional reason); requester can cancel.
- **Reports:** generated by the database, not the app (see below). Only supervisors read them.
- Registration: only emails on the `allowlist` table + its invitation code can create an account. Test accounts: limisan98@gmail.com (supervisor), limich98@gmail.com (custodian), jaredartt@gmail.com (receptionist; invite code 8436ED26).

## Database (Supabase)
Row Level Security on every table, column-level grants, SECURITY DEFINER functions (RPCs) for anything that must be restricted. Main tables: `profiles`, `roles`, `allowlist`, `areas`, `tasks`, `assignments`, `assignment_reports`, `messages`, `room_requests`, `custodian_reports`, `task_invites`, `meeting_requests`, `app_settings`. Realtime is on for the ones the app listens to (see `subscribe` in `src/api.js`).
- Reports: `generate_reports()` run by pg_cron job `bountiful-reports` every 10 min. Day report 23:30; week = Sunday–Saturday, Saturday 23:30; month on the last Saturday of the month; quarter on the last Saturday of Mar/Jun/Sep/Dec. Time zone from `app_settings.timezone` (`Europe/Berlin`).
- RPCs: `can_chat`, `assign_rooms`, `set_room_status`, `edit_room`, `invite_to_task`, `answer_invite`, `cancel_invite`, `request_meeting`, `answer_meeting`, `cancel_meeting`.

### How to change the database (no CLI access)
1. Write a new numbered file in `supabase/` (never edit an applied one), commit + push.
2. Open the Supabase dashboard SQL editor for the project (user is logged in in the browser pane), load the file text with `fetch('https://raw.githubusercontent.com/limisan98/bountiful/main/supabase/NNN_x.sql')` and `monaco.editor.getModels()[0].setValue(text)`, press Run, confirm warnings deliberately (destructive / RLS on temp table).
3. Verify with a query (functions in `pg_proc`, policies in `pg_policies`). Test RLS changes with a rolled-back transaction using a temp user.

## How to work on it
- Local test: `python3 -m http.server 8765` in the repo, open `?demo=…` URLs; Playwright (Python) with Chromium at `/opt/pw-browsers/chromium-*/chrome-linux/chrome` (`--no-sandbox`).
- Push: `git push origin main`. The sandbox can't reach github.io, so verify the live site through the browser pane (unregister service workers, clear caches, `fetch(url,{cache:'reload'})`, reload).
- Always check: all 6 locales get new keys; demo API updated; mobile (390px) *and* desktop (≥1024px) look right; icons exist in `assets/icons.js`.

## Gotchas learned the hard way
- Mobile dock shows `NAV` items with `dock:true`; `desk:true` items only appear in the desktop sidebar. Chat hides the dock under 1024px.
- Notifications only fire while the app is open or backgrounded; real push to a closed phone needs a server (VAPID + edge function) — **not built**, and the UI says so.
- `.pop` animation uses `transform`: don't combine with translate. A `<label>` can re-trigger button clicks: popovers call `stopPropagation` + `preventDefault`.
- `colorStyle()` sets `--ink`, so don't put it on containers holding buttons.
- Clear `#app` before first render (`root.textContent=''`) or the boot logo squeezes layouts.

## Not done yet / ideas
Password reset, keep-alive so the free Supabase project is not paused, real push notifications, shifts screen ("coming soon"), a UI to change the report time zone.
