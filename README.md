# NZ Underwater Hockey Championships

Tournament tracker for school, regional and club championships. This repository uses its own Cloudflare D1 database and organiser accounts. It contains no Auckland competition data or account records.

## Tournament workflow

Create a multi-day event with a court count, divisions, and teams. Each team belongs to a reusable school, region, or club. Divisions can use one or two pools, single or double round robin, and no finals, top-two, top-four, two-pool crossover, or custom finals. After saving, generate pool games, add times and courts, record results, then generate finals and placing games. The crossover option follows the supplied 2026 club draw. Winners and losers advance into linked fixtures.

Organisers can record rosters, attendance and scorers. The public sees published or completed events, schedules and results, without player rosters. Admins manage tournaments and accounts; scorers can record scores, attendance and goals. Organiser passwords are hashed in D1. The draw generator provides starting dates and court names, but **times need to be scheduled by an organiser**. Knockout matches require a decisive score; shootout handling has not yet been specified.

## First setup with Cloudflare

1. Run `npm install`. Install Wrangler with `npm install --save-dev wrangler` if it is not already available, then run `npx wrangler login`.
2. Create a **new, empty** D1 database with `npx wrangler d1 create nzuwh-championships`. Do not use the Auckland database. Copy the returned `database_id` into `wrangler.jsonc` in place of the all-zero placeholder.
3. Run `npm run db:migrate:remote` to create the tables. For a local database, run `npm run db:migrate:local`.
4. Create the first admin account. In a regular Terminal, run:

   ```sh
   read -s 'NZUWH_ADMIN_PASSWORD?New admin password (12+ characters): '
   printf '\n'
   printf '%s\n' "$NZUWH_ADMIN_PASSWORD" | node scripts/create-admin.mjs you@example.com
   unset NZUWH_ADMIN_PASSWORD
   npx wrangler d1 execute nzuwh-championships --remote --file=.admin-bootstrap.sql
   rm .admin-bootstrap.sql
   ```

   The generated SQL file contains a password hash, is ignored by Git, and should be removed after use. Use `--local` instead of `--remote` if bootstrapping a local database.
5. Run `npm run dev` to build and run the Worker with the local D1 database. Sign in with the account above. Create other admin or scorer accounts in **Account settings**. `npm run deploy` builds and deploys the Worker and static app together after the remote migration is applied.

No Supabase URL, key, or project is used. Published data is available without sign-in; all writes use the Worker API and D1 binding. Password and session cookies are never put in browser local storage. Sessions expire after seven days, and signing out removes the server-side session.

## Checks

`npm test` runs a SQLite-backed Worker integration test for authentication, tournament creation, privacy, fixtures and result advancement. `npm run build` verifies the React app. Remote D1 and deployment still need an end-to-end check after the Cloudflare account is connected.
