# 0002 — No rip-current proxy; link out to the National Weather Service
- Status: Accepted
- Date: 2026-11-23
- Deciders: Dr. Lee

## Context
Open-Meteo has no rip-current data. NWS Miami publishes a beach-forecast GeoJSON (`MFL_GIS_day1.json`), but it is unverified whether browsers can fetch it directly (CORS). A proxy function would break ADR-0001's "functions only for Claude and GitHub" rule.

## Decision
- No proxy, and no rip-current data inside the score.
- Every beach screen links to its NWS office:
  - Miami-area beaches: https://www.weather.gov/beach/mfl and the Surf Zone Forecast https://forecast.weather.gov/product.php?site=mfl&product=srf&issuedby=mfl
  - Key West beaches: https://www.weather.gov/key/
- Every verdict carries "Check NWS rip-current risk and posted beach flags."

## Consequences
- Simpler, with no extra function or credits.
- The verdict can say "Great" on a high-rip-risk day, so the safety link and wording must be prominent (Wren owns this).

## Revisit when
NWS data is confirmed CORS-accessible from the browser. A direct browser fetch would not need a proxy and would not conflict with ADR-0001.
