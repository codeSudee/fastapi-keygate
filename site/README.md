# Landing site

Static landing page for fastapi-keygate, served by Cloudflare Workers static assets. No build step for the page itself.

## Deploy

```bash
cd ../dashboard && npm run build:demo   # writes the demo to site/public/demo/
cd ../site && npx wrangler deploy
```

## Preview locally

```bash
npx wrangler dev
# or just the static files:
python3 -m http.server 8787 --directory public
```

## Notes

- `not_found_handling: "404-page"` returns a real 404 for unknown paths. The demo uses hash routes (`/demo/#/keys`), so it needs no SPA fallback and deep links survive a refresh.
- No secrets or account ids live here; `wrangler deploy` uses your own login.
