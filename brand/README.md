# Agent Standup brand files

The logo is the lead, the peach character with the gold headset, drawn exactly as in the app (`avatarSVG` in `public/index.html`): its working face (brows tilted inward, a smile), its desk, its coffee cup, and the night window of its room.

## Files

| File | What it is | Used for |
| --- | --- | --- |
| `icon.svg` | The app icon | 48 px and larger |
| `icon-32.svg` | The same with no window and thicker lines | 20 to 40 px |
| `icon-16.svg` | The face alone, thicker still | Below 20 px |
| `mark.svg` | The lead without a background | Next to the name, on any ground |
| `mark-mono.svg` | The mark in one colour (`currentColor`) | Where the system picks the colour |
| `glyph.svg` | The one-colour mark simplified, square | The VS Code side bar |
| `link-preview.svg` | The team at the office, with the name | Link previews (1280 × 640) |
| `readme-banner.svg` | The same, wide | README header (1280 × 320) |

`npm run brand` renders them into the files the extension, the desktop app, the page and the site use (`media/`, `public/icon.svg`, `public/favicon.svg`, `desktop/icon.*`, `docs/media/social.jpg`, `docs/media/banner.png`). Change a drawing here, then run it; do not edit the rendered files.

## Colours

| Name | Hex | Where it comes from |
| --- | --- | --- |
| Peach | `#E8845F` | The lead |
| Gold | `#F5C04A` | Its headset, the border of whoever is speaking |
| Teal | `#18444F` | Its room (the wall runs from `#10282F` to `#18444F`) |
| Cream | `#F6F2EA` | Its cup, light grounds |
| Ink | `#2C2F40` | The headset band, text |

## Type

Gabarito ExtraBold for the name and headings, Figtree for text. Both are open fonts (SIL Open Font License) and are only used in the two banners.

## Using the logo

The conditions for the name, the logo and the characters are in [TRADEMARKS.md](../TRADEMARKS.md). In short:

- Keep the drawing as it is: no recolouring, no stretching, no added accessories.
- Leave a quarter of the mark's width clear all round.
- Agent Standup is an unofficial community project. Do not use the logo in a way that suggests it comes from Anthropic, or that Anthropic endorses something.
