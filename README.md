# StuntListing — Gymmap

World map of stunt training schools. Runs entirely on **Cloudflare**:

- **Hosting**: Cloudflare Workers static assets (`public/` — map, admin console, analytics)
- **API**: Cloudflare Worker (`src/worker.js`) — schools, submissions, claims, analytics, admin
- **Database**: Cloudflare D1 (`gymmap`, id `3f42a52c-26cd-4ed6-8ce7-b3b4cf171640`)

## Pages

| Path         | What                                                        |
| ------------ | ----------------------------------------------------------- |
| `/`          | The map (list view, filters, submit-a-school, claim flows)  |
| `/admin`     | Password-gated admin console (approve/edit the database)    |
| `/analytics` | Aggregate view/click counts                                 |

## First-time setup in a new Cloudflare account

If the `gymmap` D1 database doesn't exist in your account yet:

```sh
git clone https://github.com/jamiestuntlisting/Gymmap.git && cd Gymmap
npx wrangler login
npx wrangler d1 create gymmap        # prints a database_id
# → paste that database_id into wrangler.jsonc (d1_databases[0].database_id)
npx wrangler d1 execute gymmap --remote --file=migrations/0001_schema.sql
npx wrangler d1 execute gymmap --remote --file=migrations/0003_seed.sql
npx wrangler deploy
```

`0003_seed.sql` contains the complete dataset (158 schools, submissions,
claims, analytics history, admin password hash) with the 0002 XMA fixes
already applied, so a fresh database is immediately production-ready.

## Deploying

The Worker (with its static assets and D1 binding) deploys from `wrangler.jsonc`:

```sh
npx wrangler deploy
```

Or connect this repo to **Workers Builds** in the Cloudflare dashboard
(Workers & Pages → Create → import this repository) and every push to the
default branch deploys automatically. No environment variables are needed —
the D1 binding is declared in `wrangler.jsonc`, and the admin password is
stored (hashed) in the database itself.

## API

Public: `GET /api/schools`, `POST /api/track`, `POST /api/submissions`,
`POST /api/claims`, `GET /api/analytics-summary`.

Admin (POST, password in body, verified server-side against a PBKDF2 hash in
D1): `data`, `save-school`, `delete-school`, `approve-submission`,
`set-submission`, `set-claim`, `change-password` under `/api/admin/`.
