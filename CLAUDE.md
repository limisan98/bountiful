# Bountiful — guide for any Claude (read this first)

Bountiful is a web app for the custodians (and receptionists) of an LDS temple. The owner is **not a coder**: explain things in plain words, keep answers short, and do the work for them. Style: minimalist, airy, very round corners, **only Tabler FILLED icons**, Lexend font, mint-based pastel palette.

- Live site: https://limisan98.github.io/bountiful/ (GitHub Pages, repo `limisan98/bountiful`, branch `main`, deploys ~1–2 min after `git push origin main`)
- Database/Auth: Supabase project `kmlvdgtxafcdbsosrsqx` (`https://kmlvdgtxafcdbsosrsqx.supabase.co`). The publishable key in `src/config.js` is public by design. **Never** put a secret/service_role key in the repo.
- Languages: English (default), German, Spanish, Portuguese, Dutch, Swedish. Every user-visible text goes through `t('key')` and must exist in **all six** files in `src/locales/`.
- Palette: mint `#86E3CE` (brand), lime `#D0E6A5`, yellow `#FFDD94`, coral `#FA897B`, lavender `#CCABD8`. Tokens are CSS variables at the top of `assets/app.css`.

## Architecture in one minute
Static site, **no build step**. Vanilla ES modules + Preact/htm (`assets/vendor/htm-preact.js`; exports `html, render, Component, createContext, useState, useReducer, useEffect, useLayoutEffect, useRef, useImperativeHandle, useMemo, useCallback, useContext, useErrorBoundary` — no Fragment/useId/portals). supabase-js is vendored (`assets/vendor/supabase.js`). Edit a file, push, done.

Data flow: `src/api.js` (all Supabase calls, plus `subscribe` for Realtime) → `src/data.js` (loads everything into the store, exposes mutations like `giveTasks`, listens to live changes) → `src/store.js` (tiny global state + `useStore()` + `toast()`) → views in `src/views/`.
**Demo mode:** `?demo=custodian_supervisor|custodian|receptionist` runs the whole app on fake data from `src/demo.js` (nothing saved). Every new feature needs a matching method in the demo API too, otherwise demo falls through to the real API and fails.

## Where is what
| Thing | File |
|---|---|
| Entry, routing, navigation (`NAV` list), demo banner | `src/app.js` (routes are hash routes `#/home|calendar|tasks|chat|team|reports|meetings|shifts`; `#/rooms` is an alias of tasks) |
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
| Shift rules (JS twin of the DB rules), priorities | `src/shifts.js` (`problem()`, `capacityOf`, `PRIORITIES`) |
| Shifts screen (on duty now + week plan), Logbook screen | `src/views/shifts.js`, `src/views/logbook.js` |
| "Larger text and buttons" switch (class `big-text` on `<html>`) | `src/access.js`, profile sheet |
| Database scripts, in the order they were run | `supabase/001…013_*.sql` (013 applied only after the push of 2026-10-09, see below) |

Screens (`src/views/`): `home.js` (tiles), `calendar.js` (day/week of assignments), `board.js` (the Tasks tab: day board, selection + "Give to…", reception's AddRooms; supervisors switch to the library), `tasks.js` (task library `LibraryView`, `TaskEditor` with templates + room kind, `TimeGoals`), `assign.js` (task row, task details with comments, `AssignSheet` plan/edit, `GiveSheet` multi-person), `chat.js` (chat list + conversations; mentions; long-press copy/delete; task invitations), `person.js` (profile card + "Send message"), `invites.js` (invitation card/sheet), `reports.js` (automatic reports), `meetings.js`, `team.js` (people, allowlist, roles), `profile.js`, `notifications.js`, `auth.js` (sign in / create account).

## Roles and the chain of work
Three roles: `custodian_supervisor` (the only supervisor; department custodian), `custodian`, `receptionist` (department reception). There is no reception supervisor.
- Only supervisors assign tasks. Custodians can *invite* a colleague to take over one of their tasks from the chat (button in composer): only the invited person accepts/declines, everyone sees Pending/Accepted/Declined, sender can cancel.
- **Rooms are tasks (supabase/012):** a room = an `assignments` row with `kind='room'`, `title` = room number, `task_id` = a library task of `kind='room'` ("Room cleaning", goal 30 min). `assignee` may be empty (= waiting for the supervisor) and times may be empty (= anytime). Reception creates rooms via RPC `request_rooms` (can edit via `edit_room_request`, withdraw while unassigned); the supervisor gives them out (or plans them directly in `AssignSheet`, which has room-number input for room tasks). One **Tasks tab** for everyone (no Rooms tab): day board, Everyone/Mine filter, day-card strip, supervisor sees a Day-by-day | Task library switch. Old table is `room_requests_archive` (unused).
- **Task states** are exactly: Not started (`todo`, gray) · In progress (`doing`, yellow) · Done (green); CSS tokens `--st-*`.
- **Several people:** `giveTasks(ids, people, share)` in data.js: first person takes the row, others get copies. Planning a task for a person who already has it re-sends a reminder (`renotify_assignment`) instead of skipping.
- **Comments:** table `assignment_comments` (assignee + supervisors read/write), shown in the task details, push via `push_on_comment`.
- **Templates:** new task sheet offers earlier tasks (even deleted) as templates + suggestions while typing the name; `AssignSheet` has "Same people as last time".
- **Chat:** only the custodian team (custodians + supervisor; receptionists have no chat). One `general` chat plus 1:1 DMs (channel `dm:<smaller id>:<bigger id>`), shown as a WhatsApp-style list (side by side with the conversation on wide screens). Long-press (or right-click) a message to copy/delete. Tapping a person's picture anywhere (any element with `data-pid`, not inside a button) opens their profile card (`PersonSheet`) with a Message button. Unread counters live in localStorage (`bountiful.chatSeen`). RLS uses `can_chat(channel)` (supabase/009).
- **Meetings:** anyone who is not a supervisor asks the supervisor for a meeting (day, time, topic); supervisor accepts or declines (optional reason); requester can cancel.
- **Reports:** generated by the database, not the app (see below). Only supervisors read them.
- Registration: only emails on the `allowlist` table + its invitation code can create an account. Test accounts: limisan98@gmail.com (supervisor), limich98@gmail.com (custodian), jaredartt@gmail.com (receptionist; invite code 8436ED26).

## Shifts, routines, priorities, logbook (supabase/013, 2026-10-09)
- **Shifts** (table `shifts`, seeded): Morning full 07:00–15:30 (8h) · Morning part 08:00–12:00 and 09:00–13:00 (4h, block 08:00) · Afternoon full 14:00–22:30 (8h; Fridays 14:30–23:00) · Evening part 18:30–22:30 (4h). Blocks (07:00/08:00/14:00/18:30) drive the "On duty now" filter. `staff_contracts` (240 or 480 min, default 480; 4h people only get part shifts, 8h only full), `shift_plan` (one shift per person per day; only supervisors edit). Capacity = min(contract, shift capacity).
- **Rules** (tasks only go to people who work that day, the task window overlaps their shift, the day's goals fit in the capacity) exist twice and must stay in sync: JS `problem()` / `distribute()` in `src/shifts.js` + `src/data.js`, SQL `shift_problem()` + trigger `guard_assignment_shift` + `allocate_waiting()` in 013. Days with no shift plan at all are not checked. Unplanned = old behaviour.
- **Allocation**: supervisor button "Give out waiting tasks" (RPC `allocate_waiting`), order: priority, window start, longest first, lowest load ratio. Rooms picked for several people in AssignSheet are shared out the same way.
- **Routines**: tasks have `priority` (high/medium/low, shown as icon + word + coloured stripe), `frequency` daily | weekdays (shown as "Weekly") | monthly (`month_day`), and `auto`. pg_cron job `bountiful-routines` (every 5 min) runs `generate_routines()`: at/after the start of the task's shift block it creates the unassigned task for the day (if not already there) and allocates it.
- **Areas**: Temple interior, Visitors' center, Guesthouse, Cafeterias, plus Offices and Annex buildings; board has "By time | By area" (area checklist with progress + steps ticked).
- **Logbook** (`logbook_entries`, crew only): handover notes per day and part of the day (morning/afternoon/evening); "needs follow-up" notes stay on top until ticked (`resolve_logbook`). No push notifications for it yet.
- Accessibility: big touch targets, icon+word labels, "Larger text and buttons" switch in the profile.

## Database (Supabase)
Row Level Security on every table, column-level grants, SECURITY DEFINER functions (RPCs) for anything that must be restricted. Main tables: `profiles`, `roles`, `allowlist`, `areas`, `tasks`, `assignments`, `assignment_reports`, `assignment_comments`, `messages`, `custodian_reports`, `task_invites`, `meeting_requests`, `app_settings`. Realtime is on for the ones the app listens to (see `subscribe` in `src/api.js`).
- Reports: `generate_reports()` run by pg_cron job `bountiful-reports` every 10 min. Day report 23:30; week = Sunday–Saturday, Saturday 23:30; month on the last Saturday of the month; quarter on the last Saturday of Mar/Jun/Sep/Dec. Time zone from `app_settings.timezone` (`Europe/Berlin`).
- RPCs: `can_chat`, `request_rooms`, `edit_room_request`, `renotify_assignment`, `invite_to_task`, `answer_invite`, `cancel_invite`, `request_meeting`, `answer_meeting`, `cancel_meeting`.

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
- Notifications only fire while the app is open or backgrounded; real push to a closed phone is covered by the push system (see "Phone push notifications").
- `.pop` animation uses `transform`: don't combine with translate. A `<label>` can re-trigger button clicks: popovers call `stopPropagation` + `preventDefault`.
- `colorStyle()` sets `--ink`, so don't put it on containers holding buttons.
- Clear `#app` before first render (`root.textContent=''`) or the boot logo squeezes layouts.

## Phone push notifications (LIVE since 2026-10-08)
Works even with the app closed. Pieces:
- `supabase/010_push_notifications.sql` (applied): `pg_net`, `push_config` (private secret + VAPID key pair, no client access), `push_subscriptions` (one row per phone/browser), RPCs `save_push_subscription` / `drop_push_subscription`, helpers `push_wants` (reads the user's saved choices from `auth.users.raw_user_meta_data.notif`; missing = the default from `TYPES` in `src/notify.js`), `push_send` (pg_net POST to the edge function), and triggers `push_message / push_assignment / push_room / push_meeting / push_invite / push_report`.
- Edge function `supabase/functions/push/index.ts` (deployed by hand in the dashboard: Edge Functions → push, **verify JWT OFF**; after changing the file, paste it again in the dashboard and Deploy). GET returns `{publicKey}` (the VAPID pair is created on first use). POST `{secret, users, key, params, url, tag}` is only accepted with the secret from `push_config`; texts come from the six-language `notify.*` dictionary embedded in the function (if you add/change a `notify.*` text in `src/locales`, regenerate/edit the dictionary inside the function too). Dead subscriptions (404/410) are deleted.
- Client: `enablePush()` / `disablePush()` in `src/notify.js` (called after login, when permission is granted in the notifications sheet, on language change; `disablePush` on sign-out). `sw.js` shows the push and skips it when an app window is visible (the app shows its own toast). When the phone is signed up, `show()` in notify.js does not repeat server-covered notifications while the app is in the background; types the server does NOT send (`done`, `started`, `delay`, `comment`, `joined`) are marked `localOnly` and still only work while the app is open/backgrounded. `reminder` and `daily` are not built at all.
- Do NOT use the `mcp__Supabase__*` tools in some sessions: they are connected to other projects ("muna"/"tactica"). Bountiful is `kmlvdgtxafcdbsosrsqx`; use the dashboard in the browser pane.
- Tested: triggers queue the HTTP calls (rolled-back transaction), the function accepts the secret and answers `{"sent":0}`. NOT yet tested with a real phone: on iPhone the app must be installed to the Home Screen first.

## Timers and time goals
- `tasks.goal_minutes` (set by the supervisor; empty = length of the task's time window) via `taskGoal(tk, a)` in `src/time.js`. The room task is a normal library task with its own goal (edited in the same Time goals sheet). Supervisors edit all goals in the "Time goals" sheet (`TimeGoals` in `src/views/tasks.js`).
- Pressing Start (task detail or the play button on a task row) opens `TimerSheet` (`src/views/timer.js`): big running clock + ring vs the goal, steps to tick, Finish. The start time is saved in the database (`assignments.started_at`, `room_requests.started_at`), so the timer survives closing the app; a "doing" task shows a timer card to reopen it. Finishing a task prefills the minutes from the timer; rooms store `minutes_spent` automatically (`set_room_status`).

## Open ideas
push for logbook follow-ups and shift changes; push for the types not yet sent by the server (`delay`, `joined`, finishing-note comments) and for `reminder`/`daily`; Team sheet could get a Message button; password reset; keep-alive so the free Supabase project is not paused; shifts screen ("coming soon"); UI to change the report time zone.

## Push notes (2026-10-09)
`sw.js` always shows a notification for a push (iPhones cancel the subscription after "silent" pushes; if the app is open the notification closes itself after 6 s and the app is told to `refresh()`), uses `renotify`. The app also calls `refresh()` (data.js) when it becomes visible/online. Server push now covers: new/changed/re-assigned task (also the same person again), room requests/edits, started, done, room done, comments. Time fields are the phone's native time picker.
