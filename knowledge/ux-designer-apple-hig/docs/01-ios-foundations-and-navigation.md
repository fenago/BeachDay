# Designing for iOS: navigation, tab bars, lists
Source:
- https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
- https://developer.apple.com/design/human-interface-guidelines/tab-bars
- https://developer.apple.com/design/human-interface-guidelines/lists-and-tables
- https://developer.apple.com/design/human-interface-guidelines/layout
- https://developer.apple.com/design/human-interface-guidelines/navigation-and-search (section landing page only)

Retrieved: 2026-11-23 (read from Apple's DocC JSON, `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`)

## Designing for iOS
From [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios):
- **Ergonomics:** people hold iPhone in one or both hands at a viewing distance of "no more than a foot or two".
- **App interactions:** sometimes "just a minute or two checking on event or social media updates". A beach check is exactly that kind of glance.
- Best practices:
  - "Help people concentrate on primary tasks and content by limiting the number of onscreen controls while making secondary details and actions discoverable with minimal interaction."
  - Adapt to orientation, Dark Mode and Dynamic Type.
  - Controls are easier to reach "in the middle or bottom area of the display". Let people swipe back.
  - "With people's permission, integrate information available through platform capabilities … without asking people to enter data", for example the device's location.

## Tab bars
From [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) (change log: "June 8, 2026 Updated terminology and art", "December 16, 2025 Updated guidance for Liquid Glass"):
- "Use a tab bar to support navigation, not to provide actions." Actions belong in a toolbar.
- "Make sure the tab bar is visible when people navigate to different sections." The exception is a modal covering it.
- Use the appropriate number of tabs; fewer is easier. "Avoid overflow tabs" (the More tab hides content).
- "Don't disable or hide tab bar buttons, even when their content is unavailable." If a section is empty, explain why.
- "Include tab labels", using single words where possible.
- Badges are "a red oval containing white text and either a number or an exclamation point". Reserve them for critical information.
- "Avoid applying a similar color to tab labels and content layer backgrounds." Over colorful content, prefer a monochrome tab bar.
- iOS: the tab bar "floats above content at the bottom of the screen" on a Liquid Glass background. It can minimize on scroll when it has an accessory.

## Lists and tables
From [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables):
- "Prefer displaying text in a list or table." Rows are easy to scan.
- "Provide appropriate feedback when people select a list item." A navigation list highlights the selected row; an options list shows a checkmark.
- "Keep item text succinct so row content is comfortable to read." For long items, list titles and show detail in a separate view.
- iOS: use a **disclosure indicator** to drill into a row's subview. An info button reveals extra information only and is not for navigation.
- Don't combine an alphabetical index with trailing controls in rows.

## Layout points that shape flows
From [Layout](https://developer.apple.com/design/human-interface-guidelines/layout):
- "Order content by relative importance" (top and leading side first).
- "Use progressive disclosure to make layouts cleaner."
- "Keep functionality the same as size classes change." Only how much is visible should change.
- Respect safe areas.

## Launching and state restoration
From [Launching](https://developer.apple.com/design/human-interface-guidelines/launching):
- "Restore the previous state when your app restarts so people can continue where they left off."

## Beach Day notes
- **Information architecture.** One primary question per screen:

| Screen | Primary question | Primary action |
|---|---|---|
| Today | "Should I go to the beach today, and when?" | See hourly (or pick another beach) |
| Beaches (picker) | "Which beach?" | Choose a beach |
| Day detail | "How does that day break down?" | Back / next day |
| Console | "Should this change ship?" | Approve or Reject |

- **Navigation:**
  - A bottom tab bar with labels **Today** and **Beaches**, which meets "use the appropriate number". The Console is reached by a link in Beaches (or `/console`), not a tab, because it isn't a top-level task for beach users.
  - Tabs never hide or disable. The Beaches tab with no favorites shows an empty state, not a disabled tab.
  - The tab bar navigates only. "Refresh" and "Change beach" are actions, so they go in the top bar.
- **Lists:**
  - The beach picker is a list of text rows with a checkmark on the selected beach.
  - The next-days strip opens day detail. Day rows use a disclosure indicator (chevron), because they navigate.
- **Restore state:** remember the last beach and open straight to Today for it. First launch is the only time the picker comes first.
- **Location:** "Nearest beach" is an optional button that asks for geolocation permission *when tapped*, never at launch (HIG: ask in context).
- Hash routes (`#/today`, `#/day/2026-11-24`, `#/beaches`) so browser back and the OS back gesture work (apple-hig skill).
