# Web app manifest: members, icons, maskable icons, screenshots
Source: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest
Source: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons
Source: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/screenshots
Source: https://web.dev/articles/maskable-icon
Source: https://web.dev/learn/pwa/installation (apple-touch-icon)
Retrieved: 2026-11-23

## File, MIME type, linking
- Extension `.webmanifest`; the spec's media-type registration says the response "should return `Content-Type: application/manifest+json`". Browsers generally also accept `.json` with `application/json` (MDN Manifest).
- Link from the `<head>` of **every** page: `<link rel="manifest" href="/manifest.webmanifest">` ("If the PWA has more than one page, every page must reference the manifest", MDN Making PWAs installable).
- If fetching the manifest needs credentials, set `crossorigin="use-credentials"` even on the same origin. Beach Day's manifest is public: no attribute.

## Members Beach Day sets
| Member | Our value | Why / rule |
|---|---|---|
| `id` | `"/"` | Stable app identity (Chrome 96+; Safari iOS 16.4+ per WebKit) |
| `name` | `"Beach Day — South Florida beach forecast"` | Install prompt + splash |
| `short_name` | `"Beach Day"` | Home-screen label; keep short (≤ 12 chars is our rule of thumb **[UNVERIFIED: no official limit on MDN]**) |
| `description` | one sentence | Shown in Android install dialog with screenshots |
| `start_url` | `"/?source=pwa"` | Required; must be inside `scope` |
| `scope` | `"/"` | Navigations outside open in the browser |
| `display` | `"standalone"` | Installable value; iOS supports only standalone |
| `theme_color`, `background_color` | placeholder `#0e7490` here; **final value decided by Sable** (docs/02 uses `#0b3b5c`, the two disagree until wave 2) | Title bar / splash |
| `icons` | `icon-192.png` any, `icon-512.png` any, `icon-maskable-512.png` maskable (all `/icons/`) | Chromium needs only 192 + 512; the separate maskable file is **our** rule |
| `screenshots` | 1 × narrow `/screenshots/today-narrow-1080x2340.png`, `1080x2340`, with `label` | Android rich install UI, stores |
| `shortcuts` | **none** | Decision (Dr. Lee): no `/console` shortcut in the public manifest |

`prefer_related_applications`: leave it out. MDN's compat table shows Chrome "No support" for the member itself, but the install criteria still say it must be absent or `false`.

## `icons` objects (MDN)
- `src`: path; relative URLs resolve against the **manifest's** URL.
- `sizes` (optional): space-separated `WxH` list, e.g. `"48x48 96x96"`; `any` for scalable formats like SVG. "For raster formats like PNG, specifying the exact available sizes is recommended."
- `type` (optional): MIME type such as `image/png`; inferred from extension if omitted.
- `purpose` (optional): space-separated, case-sensitive keywords. Valid: `monochrome` (alpha used as mask over a solid fill), `maskable` ("designed with icon masks and safe zone in mind"), `any` (default). Unknown keywords alongside valid ones are ignored; only-unknown → icon ignored.

## Maskable icons (web.dev)
- Platforms crop maskable icons to their own shape (circle, squircle…), so supply "an opaque image with some padding".
- Minimum safe zone: "a circular area in the center of the icon with a radius equal to 40% of the icon width". Keep logo/key art inside it; the outer area may be cropped.
- Test with Maskable.app (https://maskable.app/).
- Use a **separate** file for `maskable` rather than `"any maskable"` on one file: padded art looks small where an `any` icon is drawn (our validator warns) **[UNVERIFIED: web.dev page text on "any maskable" not captured in this retrieval; reasoning follows from the safe-zone padding]**.

## `apple-touch-icon` (iOS)
web.dev: add `<link rel="apple-touch-icon" href="/icons/ios.png">`; without one, iOS uses a screenshot of the page as the icon. Beach Day: 180×180 opaque PNG (`sizes="180x180"`). iOS 26 also uses manifest icons ("If you define your icons in the manifest, they're used!", WebKit WWDC25 post), but keep the link for older iOS.

## `screenshots` objects (MDN)
- `src`, `sizes`, `type` — same format as icons.
- `label` — accessible name; "it is recommended to specify this property for every screenshot."
- `form_factor` — `narrow` (mobile) or `wide` (desktop); omitted = all.
- `platform` — e.g. `android`, `ios`, `play`, `itunes`, … ; omitted = all.
- MDN calls `screenshots` supplementary metadata mainly for app stores; MDN's install guide says Android shows `description` + `screenshots` in the install prompt.

## Validated example
`examples/01-manifest-validator/manifest.webmanifest` passes our validator with 0 errors, 0 warnings; the PNGs are generated at their exact declared sizes (validator reads the PNG IHDR).

## Beach Day notes
- Netlify `_headers`: `/manifest.webmanifest` → `Content-Type: application/manifest+json` (pwa-manifest-service-worker skill). Header changes need security-engineer + netlify-engineer review.
- Icon art comes from Sable (UI designer); this folder's PNGs are placeholders with correct geometry.
- Keep `start_url` stable; `id` protects identity if it changes.
- There is no `/console` shortcut. The Console is reachable only by its URL; access is enforced by Supabase Auth plus a role check in every Function (ADR-0006), never by the manifest. (ADR-0006 is being drafted by software-architect this round.)
- `apple-touch-icon` is `/icons/apple-touch-icon-180.png`, 180×180, opaque.
- Chrome's install criteria ask for a 192 and a 512 icon only. `maskable`, `id`, `scope`, `description` and the screenshot are Beach Day rules.
