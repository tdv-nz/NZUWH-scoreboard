# NZ Underwater Hockey Championships

Tournament tracker for school, regional and club championships. This repository uses its own Cloudflare D1 database and organiser accounts. It contains no Auckland competition data or account records.

## Tournament workflow

Create a multi-day event with named courts, divisions, teams, and schedule defaults. The guided setup saves playing-day hours, breaks, court availability, court rules for each division, team colours, and whether individual goal scorers will be recorded. Each team belongs to a reusable school, region, or club; returning team identities are reused across tournaments while colours stay specific to each tournament entry. Admins can change a division's court rule while the tournament is Draft.

Divisions can use one or two pools, single or double round robin, and no finals, top-two, top-four, two-pool crossover, or custom finals. After saving, generate pool games and use the tournament schedule builder to assign times and courts. Record results, then generate finals and placing games; newly added fixtures can be scheduled without moving games already played or scheduled. The crossover option follows the supplied 2026 club draw. Winners and losers advance into linked fixtures.

Admins can generate a tournament-wide schedule from the saved playing days, court windows, breaks, game lengths, turnaround limits, and division court rules. The scheduler reports fixtures it could not place, and validates manual schedule edits against availability and court conflicts. It asks before accepting a manual court preference or turnaround warning. Rebuilding is locked once play or scoring starts; newly added unscheduled fixtures can still be placed around the existing schedule. Organisers can record rosters, attendance and scorers. The public sees published or completed events, schedules and results, without player rosters. Admins manage tournaments and accounts; scorers can record scores, attendance and goals. Organiser passwords are hashed in D1. Knockout matches require a decisive score; shootout handling has not yet been specified.

## First setup with Cloudflare

1. Install dependencies with `NODE_USE_SYSTEM_CA=1 npm_config_registry=https://registry.npmjs.org npm install`, then run `NODE_USE_SYSTEM_CA=1 npx wrangler login`. Wrangler is included as a development dependency. The system CA setting lets Node trust certificates already trusted by macOS; TLS verification remains enabled.
2. The separate `nzuwh-championships` D1 database ID is configured in `wrangler.jsonc`. Keep this binding pointed at the championships database, never the Auckland database.
3. Run `NODE_USE_SYSTEM_CA=1 npm run db:migrate:remote` to create the tables. For a local database, run `npm run db:migrate:local`.
4. Create the first admin account. In a regular Terminal, run:

   ```sh
   read -s 'NZUWH_ADMIN_PASSWORD?New admin password (12+ characters): '
   printf '\n'
   printf '%s\n' "$NZUWH_ADMIN_PASSWORD" | node scripts/create-admin.mjs you@example.com
   unset NZUWH_ADMIN_PASSWORD
   NODE_USE_SYSTEM_CA=1 npx wrangler d1 execute nzuwh-championships --remote --file=.admin-bootstrap.sql
   rm .admin-bootstrap.sql
   ```

   The generated SQL file contains a password hash, is ignored by Git, and should be removed after use. Use `--local` instead of `--remote` if bootstrapping a local database.
5. Run `npm run dev` to build and run the Worker with the local D1 database. Sign in with the account above. Create other admin or scorer accounts in **Account settings**. `npm run deploy` builds and deploys the Worker and static app together after the remote migration is applied.

### Reset a forgotten admin password

If you can sign in and know the current password, use **Account settings**. Otherwise, from a regular Terminal in the repository, generate a reset for the existing admin email and apply it to the remote D1 database:

```sh
read -s 'NZUWH_ADMIN_PASSWORD?New admin password (12+ characters): '
printf '\n'
printf '%s\n' "$NZUWH_ADMIN_PASSWORD" | node scripts/reset-admin.mjs admin@example.com
unset NZUWH_ADMIN_PASSWORD
NODE_USE_SYSTEM_CA=1 npx wrangler d1 execute nzuwh-championships --remote --file=.admin-reset.sql
rm .admin-reset.sql
```

Check that Wrangler reports `reset_admin_count` as `1`. The reset clears that admin's login lockout and revokes their existing sessions. Use `--local` instead of `--remote` to reset the local database. The generated SQL contains only the password hash, is ignored by Git, and should be deleted after use.

### Cloudflare Pages previews

The primary deployment is a Worker with Static Assets. If this repository is also built as a Pages project, use `npm run build` with `dist` as the output directory; the `functions/api/[[path]].ts` adapter forwards `/api/*` requests to the same Worker API. Configure a `DB` D1 binding for both Preview and Production in the Pages project before redeploying. Use an isolated preview database if preview users may submit writes; the configured Worker database is the production database.

No Supabase URL, key, or project is used. Published data is available without sign-in; all writes use the Worker API and D1 binding. Password and session cookies are never put in browser local storage. Sessions expire after seven days, and signing out removes the server-side session.

## Checks

`npm test` runs SQLite-backed Worker integration tests for authentication, public privacy, migration backfills, setup settings, court rules, team reuse, fixtures and result advancement. `npm run build` verifies the React app. Remote D1 and deployment still need an end-to-end check after the Cloudflare account is connected.
