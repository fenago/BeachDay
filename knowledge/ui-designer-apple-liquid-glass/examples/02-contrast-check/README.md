# Example 02: WCAG contrast check for tokens, including text on glass

## What it demonstrates
`contrast.mjs` reads the real `../01-glass-tokens-demo/tokens.css` (light block and dark block) and checks it, with no dependencies.

How it models glass:
- It composites the glass tint (`--glass-bg`) over **every background the glass can sit on**: the condition gradient stops plus solid white and black for content scrolling under bars.
- It repeats that with the top highlight layer added, and for the strong-glass variant.
- It then checks each foreground against the **worst** composite.

What it checks:
- **1.4.3 (4.5:1):**
  - `--text`, `--text-2` and `--link` on glass, and on the solid fallback surface
  - each verdict chip label (`--on-verdict-*` on `--verdict-*`)
  - the primary button label
- **1.4.11 (3:1):**
  - the accent button fill vs adjacent glass
  - the border of icon-only controls
  - the focus ring

Ratios use the WCAG 2.2 relative-luminance and contrast-ratio definitions and are **not rounded** (4.498 fails). The script exits 1 on any failure, so it can gate CI.

Why it's "what good looks like": "text on glass passes" is a computed claim covering the worst background, both color schemes and the fallback surface. It is not an eyeballed screenshot.

## How to run
```bash
node contrast.mjs                  # checks ../01-glass-tokens-demo/tokens.css
node contrast.mjs path/to/tokens.css
```

## Verified
**First run** (tokens as first drafted) failed 4 of 34 checks. That shows why the script exists: the light link scored 4.498:1 and prints as "4.50" but fails.
```
light   --link on glass (worst: glass/--bg-scroll-worst-dark)          #0b4f86  #bdbdbd  4.50   4.5  FAIL
light   --control-border vs glass (worst: glass/--bg-scroll-worst-dark) [1.4.11] #5c6b7a  #bdbdbd  2.90   3    FAIL
dark    --link on glass (worst: glass+hl/--bg-scroll-worst-light)      #8fd0ff  #4d5762  4.42   4.5  FAIL
dark    --control-border vs glass (worst: glass+hl/--bg-scroll-worst-light) [1.4.11] #8a9aab  #4d5762  2.55   3    FAIL
30/34 checks pass
```
**Fix:** light `--link` #0b4f86 → #0a4677 and `--control-border` #5c6b7a → #4f5d6b; dark `--link` #8fd0ff → #a8dcff and `--control-border` #8a9aab → #a7b4c2.

**Second run**, `node contrast.mjs`, exit 0 (trimmed):
```
light   --text on glass (worst: glass/--bg-scroll-worst-dark)          #0b1b2b  #bdbdbd  9.24   4.5  PASS
light   --text-2 on glass (worst: glass/--bg-scroll-worst-dark)        #33414f  #bdbdbd  5.54   4.5  PASS
light   --link on glass (worst: glass/--bg-scroll-worst-dark)          #0a4677  #bdbdbd  5.17   4.5  PASS
light   --on-verdict-great on --verdict-great                          #ffffff  #1d7f46  5.03   4.5  PASS
light   --on-verdict-good on --verdict-good                            #ffffff  #0f6b7b  6.16   4.5  PASS
light   --on-verdict-fair on --verdict-fair                            #1f1400  #f2a93b  9.08   4.5  PASS
light   --on-verdict-skip on --verdict-skip                            #ffffff  #b3261e  6.54   4.5  PASS
light   --control-border vs glass (worst: glass/--bg-scroll-worst-dark) [1.4.11] #4f5d6b  #bdbdbd  3.58   3    PASS
dark    --text on glass (worst: glass+hl/--bg-scroll-worst-light)      #f2f6fa  #4d5762  6.76   4.5  PASS
dark    --text-2 on glass (worst: glass+hl/--bg-scroll-worst-light)    #c3cfdb  #4d5762  4.64   4.5  PASS
dark    --link on glass (worst: glass+hl/--bg-scroll-worst-light)      #a8dcff  #4d5762  5.01   4.5  PASS
dark    --on-accent on --accent                                        #04192c  #6cc0f5  8.89   4.5  PASS
dark    --control-border vs glass (worst: glass+hl/--bg-scroll-worst-light) [1.4.11] #a7b4c2  #4d5762  3.48   3    PASS
dark    --focus vs glass (worst: glass+hl/--bg-scroll-worst-light) [1.4.11] #ffd166  #4d5762  5.09   3    PASS

34/34 checks pass
```

## Limits
- The model is source-over compositing of flat colors. It ignores `saturate()` and anti-aliasing (WCAG says to use the specified colors anyway). Primary text keeps a margin for that reason. Dark `--text-2` at 4.64 is the tightest; don't lighten the dark glass further without re-running.
- Values written with `color-mix()` are not parsed. Keep contrast-relevant tokens as rgb/hex (see docs/06).
