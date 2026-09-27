# New Zealand Underwater Hockey Championships

Independent tournament tracker for school, regional and club championships. It has fresh Git history, a separate database schema, and no Auckland players, teams, accounts or results.

## Current workflow

- Create a multi-day tournament in one setup flow: name and dates, number of courts, school/regional/club divisions, teams and pool assignments. Every team is linked to a reusable school, region, or club; multiple teams across grades can share one organisation.
- Choose one or two pools, a single or double round robin, and a finals format separately for each division before saving. The event, divisions and teams are written in one database transaction. Generate the pool fixtures when ready.
- Set dates, times, courts and referees for each game. Record scores and view pool standings. Print or export a combined schedule across all divisions.
- After all pool games are complete, generate the selected finals format: no finals, top-two final, top-four semi-finals and final, two-pool crossover quarter-finals and semi-finals, or custom fixtures. The crossover option follows the supplied 2026 club draw. Winners and losers feed later matches automatically. Add other placing games individually.
- Organisers can enter private team rosters, match attendance and goal scorers. Public users see published and completed tournaments; only an admin can edit.

The draw generator sets an initial date and distributes fixtures across the configured court names, but **does not allocate times**. Dates, court assignments and times must be checked against the actual tournament timetable. Pool rankings use points, goal difference, then goals scored. Tied knockout matches need an explicit winner before the next game can populate; shootout handling still needs defining. Player rosters and match attendance are available to signed-in organisers; public pages do not expose player names. More detailed player reports are still to be built.

## Separate Supabase project

1. Create a **new** Supabase project. Never link this repository to the Auckland project.
2. Run the files in `supabase/migrations/` in filename order in the new project's SQL editor. The first migration creates empty tables and row security policies; the second adds court and finals settings plus atomic tournament creation; the third adds reusable school, region, and club records and links existing named teams.
3. Create an organiser in that new project's Authentication > Users page.
4. In the new project's SQL editor, give that account the admin role, replacing the email:

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'organiser@example.com';
   ```

5. Copy `.env.example` to `.env.local`; fill it with **the new project's** URL and publishable key. Never use a service-role key in a `VITE_` variable.
6. Run `npm install` and `npm run dev` for local use. Add the same two environment variables to the separate hosting project when deploying.

The app refuses to connect to the known Auckland Supabase URL. No credentials or database data are included in this repository.

## GitHub handoff

Create an empty GitHub repository named `nz-uwh-championships`, then from this directory run:

```sh
git remote add origin <new-repository-url>
git push -u origin main
```

This repository must never share a Supabase project or deployment environment with the Auckland tracker.
