# NZUWH Scorer: plan to complete the build prompt

This plan compares the supplied build prompt with the code in this repository. The tournament setup and storage slice has now been implemented; remaining items below are still open.

## What is already here

- A separate React/TypeScript app, Cloudflare Worker API, D1 binding, migrations, Static Assets routing, local/deploy scripts, and first-admin bootstrap tooling.
- Reusable organisation records for schools, regions, and clubs; tournament, division, team-entry, player, roster, match, goal, organiser, and session tables.
- A single-page setup form that creates a Draft tournament, divisions, and teams in a D1 batch. It validates pool sizes, division team names, and the supported finals formats.
- A four-step setup wizard that saves named courts, reusable team identities, tournament-specific team colours, playing-day windows, breaks, court availability, schedule defaults, per-division court rules, and the goal-scorer setting.
- Draft-only court-rule editing and a migration that adds the new records while retaining existing entries, colours, fixture court labels, and dates.
- Single and double round-robin fixture generation, tournament-wide slot assignment using saved court/day rules, unscheduled reasons and fallback notes, guarded manual schedule edits, basic seeded finals, result entry, winner/loser links for some knockout games, standings, and combined schedule print/CSV export.
- Worker-side role checks, same-origin write checks, PBKDF2 password hashing, hashed session tokens, HTTP-only SameSite cookies, seven-day sessions, password changes, and public filtering of Draft events.
- A small SQLite-backed Worker integration suite and setup notes in the README.

The main implementation is in [src/App.tsx](src/App.tsx), [src/TournamentSetup.tsx](src/TournamentSetup.tsx), [worker/index.ts](worker/index.ts), [worker/schedule.ts](worker/schedule.ts), [worker/auth.ts](worker/auth.ts), and the migrations.

## Main gaps against the prompt

1. **Tournament setup and storage:** the initial creation/storage gap is addressed by the new wizard and D1 migration. Playing-day and court availability can be entered during setup; only division court rules have a post-creation editor, and that editor is available while the event remains Draft. An admin editor for changing the other setup settings after creation is still needed.
2. **Scheduling:** the core generator and manual slot validation are now implemented. Still useful: add schedule filters and a dedicated editor for bulk adjustments.
3. **Rosters and scoring:** the current model has match-level attendance, and goal entry requires a player to be marked present for that match. The prompt defines the tournament roster itself as attendance and explicitly removes that match-level prerequisite. The UI cannot reuse or remove a roster entry, record an unattributed goal, enforce goals against the final score, or hide all goal controls when scoring is disabled.
4. **Scoring workflow and roles:** scores are edited inside the draw list; there is no focused poolside scoring route, match lookup/filter workflow, in-progress action, completed-result confirmation, or explicit offline/loading feedback. The API gives Scorers score permissions, but goal APIs do not yet enforce the tournament scoring setting and the bootstrap response loads broad private data for every signed-in role.
5. **Finals and standings:** top-two, top-four, and crossover generation are partial. Pool seeds are resolved to teams at generation time, so later pool-result corrections cannot reseed them. Downstream completed-game conflicts are neither reported nor resolved for the organiser. The close-loss points column is stored but not used in standings; point values are not configurable in the UI.
6. **Public results and reports:** print and CSV exist, but there is no stable shareable tournament URL, schedule filters, or public scorer statistics. Public statistics must be gated by the tournament setting, while rosters and attendance stay private.
7. **Authentication and production checks:** new hashes use three chained 100,000-iteration PBKDF2-SHA-512 passes to fit Cloudflare Workers' Web Crypto per-operation limit. A locked account receives a distinct 429 response, and reset/bootstrap scripts create or update admin hashes. The present integration suite does not cover most required auth, scheduling, goal-setting, finals-correction, or privacy cases.

## Build order

The first implementation slice covers the D1 structures, atomic setup persistence, guided setup, reusable team identities, and Draft-only division court-rule editing. The next completed slice adds schedule generation and guarded manual slot edits.

### 1. Lock down the domain model and migrate D1

Add a new migration; keep the applied initial migration immutable. Add tournament courts and court availability, division court rules, day-level schedule settings and breaks, and the tournament-wide goal-scorer flag. Make matches reference tournament court records and hold schedule diagnostics. Preserve source links for pool seeds, winners, and losers. Make returning teams reusable across tournament entries. Treat each tournament team entry's roster as that tournament's attendance record; remove match attendance from goal eligibility. Preserve existing entries and recorded results while backfilling court records and reconciling any duplicate team identities.

At the same time, define typed API payloads and server-side validators for these records. Keep structure changes Admin-only and score changes available to Scorers. Split public, private-admin, and scoring queries so a public response can never include roster data and a Scorer receives only the match and roster data needed for scoring.

**Done when:** a migration preserves existing data; tournament creation can atomically persist courts, divisions, teams, rules, and settings; server validation rejects invalid organisation links and tournament formats.

### 2. Finish tournament setup and reusable records

Turn setup into a guided flow: event details, named courts, divisions and teams, pool/finals choices, per-division court rules, day/time settings, then a review screen. Match the requested school, regional, and club division names. Allow selecting an existing organisation and team, creating a new one, and reusing a player later. Default every new tournament to Draft. Add roster add/remove and attendance views at tournament, division, team, and organisation levels, with CSV export.

**Done when:** an admin can configure the full event before creation, return to edit permitted settings before publication, and see historical tournament rosters remain attached to their original entries.

### 3. Build the schedule engine and safe manual editing

Keep round-robin pairing as a distinct step, then schedule all generated fixtures against the configured days, time windows, breaks, court availability, durations (including halftime), and turnaround limits. Place required-court divisions first, respect preference order, mark permitted fallbacks, avoid consecutive games for a team when possible, and spread play across days. Return an explanation for every unscheduled game and a summary of placements and conflicts. Use the same validator for manual edits; reject prohibited courts and clashes, and explain turnaround or preference warnings before saving. Regeneration is blocked once a match starts or has a result.

**Done when:** generation never breaks a required-court, court-availability, court-time, or turnaround rule; unscheduled games remain visible with actionable reasons; regenerating is allowed only before results exist. Implemented in `worker/schedule.ts`, `POST /api/tournaments/:id/schedule/generate`, and the Schedule and Draw views.

### 4. Complete finals and advancement

Implement top-two, top-four, two-pool crossover, and custom knockout/placement formats as persisted fixtures with explicit seed/winner/loser sources. Recalculate linked positions after a feeder result changes. Never rewrite a completed downstream game; return a clear conflict for organiser review. Validate decisive knockout scores and support the requested final, bronze, and placement games.

**Done when:** correcting a pool result can update pool-seed qualifiers before play, correcting a knockout result updates every eligible downstream slot, and completed downstream games are surfaced without being overwritten.

### 5. Correct roster and goal workflows; add poolside scoring

Make tournament roster membership the attendance record. Add an admin workflow to find or create players, reuse them, add/remove tournament roster entries, and export attendance. Add the tournament-wide “Record individual goal scorers” setting. When enabled, allow player goals and unattributed team goals, validate team and roster membership, prevent attributed/unattributed totals exceeding the team score, and warn when the tally does not match the score. When disabled, hide controls and suppress scorer statistics without deleting tournament rosters.

Create a focused match scoring route with current/upcoming/completed, court, division, and day filters. Show match context and team colours, large score controls, in-progress and completed states, a confirmation before changing a completed result, and saved/error/loading feedback. Enforce every restriction in the Worker as well as the interface.

**Done when:** a Scorer can find and update a match without using administration screens; scoring mode controls API validation and all scorer statistics; goals need no per-match attendance record.

### 6. Finish standings, schedule sharing, and public results

Add configurable division points and a ranking function that can accept further tie-break rules. Complete combined schedule filters and retain print/browser PDF and CSV export. Add a stable public tournament URL and responsive public pages for published/completed tournaments, fixtures, results, standings, finals progression, and scorer statistics only when enabled. Keep Draft events, rosters, attendance, accounts, and sessions out of public responses.

**Done when:** links can be shared without sign-in, and tests prove every public endpoint excludes private and Draft data.

### 7. Close security and release gaps

Implement the specified three-pass password derivation with a safe transition for existing hashes. Make lockout responses generic, implement the agreed password-reset path, and make the first-admin bootstrap safely create or update the account, clear old sessions, and keep password text out of SQL. Review API authorization and data scope route by route. Add integration coverage for the prompt's auth, privacy, organisation/team reuse, tournament creation, rosters, both scoring modes, schedule rules, draw/finals/advancement, role limits, and cross-origin writes.

Before release, run TypeScript, lint, unit/integration, production build, and D1 migration checks; then verify local Worker/D1 behavior and complete a Cloudflare deployment smoke check.

## Release gates and open details

- Do not publish the tournament or deploy the completed application until court, scheduling, scoring-mode, role, and public-privacy workflows pass their acceptance checks.
- The prompt requires password resets but does not specify reset delivery. Choose either an admin-issued reset flow or an email delivery provider before implementing self-service reset links.
- The prompt requires decisive knockout results but does not define shootout/overtime entry. Keep score validation strict and settle that result-entry convention with the tournament organisers before finalising the poolside UI.
