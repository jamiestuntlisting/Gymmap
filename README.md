# StuntListing — Gymmap

World map of stunt training schools. Runs entirely on **Cloudflare**:

- **Hosting**: Cloudflare Workers static assets (`public/` — map, admin console, analytics)
- **API**: Cloudflare Worker (`src/worker.js`) — schools, submissions, claims, analytics, admin
- **Database**: Cloudflare D1 (`gymmap`, id `47e6cc96-f549-44e9-b535-fbf1fa1e4817`)

## Pages

| Path         | What                                                        |
| ------------ | ----------------------------------------------------------- |
| `/`          | The map (list view, filters, submit-a-school, claim flows)  |
| `/admin`     | Password-gated admin console (approve/edit the database)    |
| `/analytics` | Aggregate view/click counts                                 |

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
