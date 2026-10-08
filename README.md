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
| `assets/logo/` | **Provisional** logo and app icons: replace with your own |
| `assets/vendor/` | Libraries (kept here so the site never depends on another server) |
| `supabase/` | The database setup scripts, in the order they were run |

## Security in one paragraph
The Supabase URL and "publishable" key inside `src/config.js` are public by design.
Data is protected by Row Level Security rules in the database, and only people whose email
**and** invitation code are on the supervisor's list can create an account.
Never put a `secret` / `service_role` key anywhere in this repository.
