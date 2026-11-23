# 0001 — Static site + Netlify Functions, no other servers
- Status: Superseded by 0006
- Date: 2026-11-23
- Deciders: Dr. Lee

## Context
Beach Day needs weather data, an installable mobile app, and an Agent Console that calls Claude and commits to GitHub. Open-Meteo is keyless and CORS-enabled, and it rate-limits calls from shared hosting IPs early. See `docs/03-architecture-netlify.md`.

## Decision
- The front end is a static PWA on Netlify (`public/`).
- The browser calls Open-Meteo directly.
- Netlify Functions are used **only** for the Claude API and GitHub calls behind the Agent Console. They also cover the Console's own login, the job and proposal endpoints, and Netlify Blobs for state.
- No other servers, databases or third-party backends.

## Consequences
- Secrets live only in Function env vars.
- Long agent jobs must fit Netlify's limits: 60 s for sync/stream functions and 15 min for background functions.
- No shared server-side weather cache. The service worker caches weather per device.

## Revisit when
Ads or subscriptions make the app commercial, which requires an Open-Meteo API key and probably a proxy. Also revisit if agent jobs regularly need more than 15 minutes (consider Claude Managed Agents).
