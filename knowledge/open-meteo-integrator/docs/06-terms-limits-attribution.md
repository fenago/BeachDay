# Terms, fair-use limits, caching and attribution (CC BY 4.0)
Source: https://open-meteo.com/en/terms
Source: https://open-meteo.com/en/licence
Source: https://open-meteo.com/en/pricing
Retrieved: 2026-11-23

## Free (non-commercial) terms — quoted from /en/terms
- "Less than 10'000 API calls per day, 5'000 per hour and 600 per minute."
- "You may only use the free API services for non-commercial purposes."
- "You accept to the CC-BY 4.0 licence"
- "We reserve the right to block applications and IP addresses that misuse our service without prior notice."
- "Rate limits are applied by IP addresses and application. If you are using providers like Vercel, Netlify, Render, or Google Sheets you might be rate-limited earlier then expected. Consider using Cloudflare Workers, as we apply limits per Cloudflare user."

Monthly cap (terms + pricing table): Free / Open-Access = **300,000 calls / month**, with ⚠️ markers on minute/hour/day/month limits.

## What counts as non-commercial
Defined per Creative Commons' NonCommercial interpretation. Examples given:
- Non-commercial: "Private or non-profit websites or apps that do not have subscriptions or advertising", personal home automation, public research, educational content, and "Voluntary donations, including contributions through a tip jar, are permitted."
- Commercial: "Websites or apps that have subscriptions or display advertisements", commercial products or promotional activities, undisclosed research at commercial entities.

## How a "call" is counted (pricing page FAQ)
- "Typically, one API call corresponds to one HTTP API request."
- "Requests for data covering more than 10 weather variables or extending over a period of more than 2 weeks for a single location are considered multiple API calls."
- Fractional: "a request for 2 weeks of data with 15 weather variables will be calculated as 1.5 API calls, while 4 weeks of data equals 3.0 API calls."
- Monthly overage (paid plans): alerts at 80/90/100%; "until it is live, no hard cutoffs are enforced" and "Until it is available, monthly limits are not enforced." Daily/minute limits on the free tier still apply.
- No uptime guarantee on the free API: "The free API is for non-commercial use, rate-limited to 10,000 calls/day, and carries no uptime guarantee."

## Licence and attribution — quoted from /en/licence
- "API data are offered under Attribution 4.0 International (CC BY 4.0)".
- "You must give appropriate credit, provide a link to the licence, and indicate if changes were made."
- "You must include a link next to any location Open-Meteo data are displayed, for example:"
```html
<a href="https://open-meteo.com/">Weather data by Open-Meteo.com</a>
```
- The Marine page adds: "All users of Open-Meteo data must provide a clear attribution to the providers of the models they use as well as a reference to Open-Meteo." Marine sources listed: MeteoFrance/Copernicus Marine (MFWAM, SMOC, SST), ECMWF WAM, NOAA NCEP GFS Wave, DWD EWAM/GWAM, ERA5-Ocean (Copernicus C3S). Source: https://open-meteo.com/en/docs/marine-weather-api#citation
- Upstream model licences (DWD CC-BY, ECMWF CC-BY, NOAA, Copernicus, UK Met Office CC-BY-SA, …) are listed on the licence page.
- Server code is AGPLv3 (only relevant if self-hosting).

## Disclaimer
"Open-Meteo assumes no responsibility for any inaccuracies or omissions in the data, their availability, or any losses or damages resulting from their usage." — supports our "Beach Day is not a safety service" wording.

## Privacy
For the free API, Open-Meteo may collect IP addresses and keeps web-server logs "that may contain sensitive information such as geographical coordinates", deleted after 90 days. Requests carry the beach coordinates only (never the user's GPS position) — keep it that way.

## Caching
The docs/terms pages don't prescribe a cache TTL **[UNVERIFIED: no official TTL]**. Model update frequencies (e.g. marine models "Every 6 hours"/"Every 12 hours", per the Marine data-source table) mean refreshing more than every 30–60 min returns mostly identical data. Our policy: stale after 30 min, refresh only on user-driven events, never poll (example `03-cache-age`).

## Budget for Beach Day
Per beach view: 1 Forecast (18 vars ≈ 1.8 calls) + 1 Marine (8 vars, 1 call) ≈ 2.8 calls. Because calls come from each user's own IP (browser-direct, ADR-0001), the 10k/day limit applies per user device/network, not to the whole app — one user would need ~3,500 beach loads a day to hit it. If these calls went through a Netlify Function, every user would share Netlify's egress IPs and the terms explicitly warn about that.

## Beach Day notes
- Keep the exact attribution link visible next to every forecast/score view (CLAUDE.md rule), plus a short "Wave data: Copernicus Marine, ECMWF, NOAA, DWD via Open-Meteo" line on the about/credits screen for the Marine requirement. State that scores are Beach Day's own derivation ("indicate if changes were made").
- No ads, no subscriptions while on the free tier (ADR-0001 "Revisit when": going commercial needs an API key and the `customer-` host, which would also need a key-hiding proxy — a new ADR).
- Never proxy Open-Meteo through Netlify Functions (ADR-0001; terms warn Netlify IPs are rate-limited earlier).
- Treat any 429/limit response as "busy": serve cached data, back off, don't retry in a loop.
