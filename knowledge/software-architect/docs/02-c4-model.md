# The C4 model (context and container diagrams)
Source: https://c4model.com/ ; https://c4model.com/abstractions/container ; https://c4model.com/diagrams/system-context ; https://c4model.com/diagrams/container
Retrieved: 2026-11-23

## What C4 is

From [c4model.com](https://c4model.com/), by Simon Brown:

1. Hierarchical **abstractions**: software systems, containers, components, code.
2. Hierarchical **diagrams**: system context, containers, components, code.
3. Supporting diagrams: system landscape, dynamic, deployment.
4. **Notation independent** and **tooling independent**.

## Container: the key abstraction

From [abstractions/container](https://c4model.com/abstractions/container):

- "Not Docker! In the C4 model, a container represents an **application** or a **data store**. A container is something that needs to be running in order for the overall software system to work."
- Examples the page lists: server-side web app, **client-side web application** (JavaScript in a browser), mobile app, **serverless function** ("A single serverless function (e.g. Amazon Lambda, Azure Function, etc)"), database, **blob or content store** (S3, CDN), file system, shell script.
- "A container is essentially a runtime boundary around some code that is being executed or some data that is being stored."
- **SPA + server = two containers:** "If there's a significant quantity of JavaScript being delivered by the server-side web application (e.g. a single-page application ...), then that's two containers", because they are "two separate process spaces, communicating via an inter-process/remote communication mechanism".
- JARs, DLLs and **modules are not containers**; they organise code within a container.
- **Hosted data stores you own data in are containers:** with S3 "you do have ownership and responsibility for the buckets you are using ... treat them as containers".

## System context diagram

From [diagrams/system-context](https://c4model.com/diagrams/system-context):

- Show "your system as a box in the centre, surrounded by its users and the other systems that it interacts with."
- Focus on "people ... and software systems rather than technologies, protocols and other low-level details". Anyone, technical or not, should be able to read it.
- Scope: a single software system. Supporting elements: people and directly connected external systems "you don't have responsibility or ownership of".
- **Recommended** for all teams.

## Container diagram

From [diagrams/container](https://c4model.com/diagrams/container):

- "Zoom in to the system boundary". It "shows the high-level shape of the software architecture and how responsibilities are distributed across it. It also shows the major technology choices and how the containers communicate".
- Scope: one system. Primary elements: its containers. Supporting elements: the people and systems connected to them.
- Audience: technical people (architects, developers, ops). **Recommended**.
- It "says very little about deployment aspects such as clustering, load balancers ... Deployment information is better captured via one or more deployment diagrams".

## Notation practice

The notation page was not read in this retrieval. The site says diagrams are notation-independent. The usual guidance (a title and key on every diagram, a type and technology on every element, a labelled direction on every relationship) is **[UNVERIFIED]** here, but it is cheap to follow. Mermaid has `C4Context` / `C4Container` diagram types. These are marked experimental in Mermaid's docs, which is **[UNVERIFIED]** in this retrieval, so this repo's example uses plain `flowchart` syntax, validated with Mermaid 11.

## Beach Day notes

How C4 maps onto Beach Day (ADR-0006, which restates ADR-0001):

| C4 element | Beach Day | Owned by us? |
|---|---|---|
| Person | Beach-goer (phone); Dr. Lee (Console operator) | — |
| Software system in scope | **Beach Day** | Yes |
| External system | Open-Meteo Forecast API, Open-Meteo Marine API, Anthropic Claude API, GitHub (`fenago/BeachDay`), **Supabase Auth** (identity + `profiles.role` only, ADR-0006), Google (OAuth sign-in), NWS (link-out only, ADR-0002), Netlify CI/CD | No |
| Container | **PWA** (client-side web app + service worker) | Yes |
| Container | **Agent Console UI** (client-side, `/console`) | Yes |
| Container | **Netlify Functions**: one container per function in C4 terms ("A single serverless function"). Drawn as one group for readability | Yes |
| Container | **Netlify Blobs** stores: proposals, jobs, ratelimit, audit. A hosted store we own data in, so a container | Yes |
| Container | CDN static hosting of `public/` (the "content store") | Yes (config) |

Rules the diagrams must show, because they *are* the architecture:

- The browser → Open-Meteo arrow goes **directly** from the PWA. There is no function in between (ADR-0001, restated in ADR-0006).
- NWS is a **hyperlink** relationship, not a data fetch (ADR-0002).
- Only Functions talk to Claude and GitHub; secrets live only there.
- The Console UI talks to Supabase Auth directly (publishable key), and every Function checks token + role with Supabase (ADR-0006). Supabase is drawn as an external system, not a container: we hold no app data there.
- GitHub → Netlify CI is the deploy path after Approve (ADR-0003).
- No database or other server containers of our own exist. Anything beyond identity in Supabase, or any other store, needs an ADR first.

Validated Mermaid source for both diagrams is in `examples/01-c4-diagrams/`. Put design notes in `docs/design/<topic>.md`, with the diagrams inline.
