# Bountiful

Shared tasks and teamwork for the temple crew. Minimal, rounded, and easy to use.

**Live site:** https://limisan98.github.io/bountiful/
**Preview the design without logging in:** add `?demo=supervisor` (or `custodian`, `receptionist`) to the address.

## What is where
| Folder / file | What it is |
|---|---|
| `index.html` | The single page the app lives in |
| `src/` | The app's code (screens, languages, database calls) |
| `src/locales/` | Translations: English, German, Spanish, Portuguese, Dutch, Swedish |
| `assets/app.css` | All colors, sizes and rounded corners |
| `assets/icons.js` | The Tabler *filled* icons the app uses (MIT license) |
| `assets/logo/` | The Bountiful logo in the palette colors (`logo-original.svg` is the first version; `logo-square.svg` is square; `logo.svg` / favicon have rounded corners) and the app icons made from it |
| `assets/lexend.css` | The Lexend font (all weights, embedded so no outside server is contacted) |
| `assets/vendor/` | Libraries (kept here so the site never depends on another server) |
| `supabase/` | The database setup scripts, in the order they were run |

## Three roles
Custodian Supervisor, Custodian, Receptionist. Reception lists rooms to clean; the Custodian Supervisor gives each room to a custodian;
the custodian marks it done. Custodians can invite each other (in the custodians' chat) to take over a task; only the invited person can accept or decline, and the sender can cancel.

## Meetings
Everyone who is not a supervisor can ask the supervisor for a meeting (day, time, topic) from the Meetings screen. The supervisor accepts, or declines with an optional reason; the requester can cancel. Only the two people involved can see a request (`supabase/007_meeting_requests.sql`).

## Automatic reports
The database writes them by itself (`supabase/005_automatic_reports.sql`, run by `pg_cron` every 10 minutes):
daily at 23:30, weekly on Saturday at 23:30 (Sunday to Saturday), monthly on the last Saturday of the month, quarterly on the last Saturday of March, June, September and December.
"23:30" is in the time zone stored in the `app_settings` table (`timezone`, currently `Europe/Berlin`). Only supervisors can read the reports.

## Security in one paragraph
The Supabase URL and "publishable" key inside `src/config.js` are public by design.
Data is protected by Row Level Security rules in the database, and only people whose email
**and** invitation code are on the supervisor's list can create an account.
Never put a `secret` / `service_role` key anywhere in this repository.
