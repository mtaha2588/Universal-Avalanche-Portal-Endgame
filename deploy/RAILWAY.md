# Put the portal online with Railway

Result: a public HTTPS link such as `https://avalanche-portal-production.up.railway.app`. Anyone opens it in a
browser. Nobody needs the project files, and your PC can be switched off.

Railway gives a free trial credit, then costs about $5 a month (check https://railway.com/pricing).
The portal uses about 450 MB of memory, so the plan must allow at least 512 MB (1 GB is comfortable).

## Files used

| File | Purpose |
|---|---|
| `Dockerfile` | How Railway builds and starts the portal (Python 3.12 + Waitress on Railway's `PORT`) |
| `.railwayignore`, `.dockerignore` | Keep `.env`, `.venv`, caches and `dist/` out of the upload |

`.env` is never uploaded. The Mapbox token and secret key are set as Railway **Variables** instead.

## First deployment

```powershell
railway login                                   # opens the browser; sign in with GitHub or email
railway init --name avalanche-portal            # creates the project
railway add --service avalanche-portal          # creates the service
railway variables --service avalanche-portal --set "MAPBOX_TOKEN=pk...." --set "SECRET_KEY=<long random string>"
railway up --service avalanche-portal --detach  # uploads (~57 MB) and builds (2-4 minutes)
railway domain --service avalanche-portal       # prints the public link
```

## Updating after changes

```powershell
railway up --service avalanche-portal --detach
```

## Useful

| Task | Command |
|---|---|
| Build / run log | `railway logs --service avalanche-portal` |
| Open the dashboard | `railway open` |
| Change a variable | `railway variables --service avalanche-portal --set "NAME=value"` |

Mapbox: if the token has URL restrictions, add the `*.up.railway.app` link in your Mapbox account; otherwise the
map falls back to the free MapLibre / Esri basemap.
