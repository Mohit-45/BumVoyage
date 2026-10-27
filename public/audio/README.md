# Fart recordings

The game plays real recordings, cut into short clips. Which clips play is controlled by `manifest.json`.

## Included recordings

| File | Source | Author | License |
| --- | --- | --- | --- |
| `wet-fart.wav` | [Wet fart tummy rumbles.ogg](https://commons.wikimedia.org/wiki/File:Wet_fart_tummy_rumbles.ogg) on Wikimedia Commons (first fart only, trimmed and converted to WAV) | natalie | Public domain |
| `gastric-distress.wav` | [Gastric Distress](https://opengameart.org/content/gastric-distress) on OpenGameArt | LFA | CC0 |

Neither license needs credit, but it's nice to give it.

## How clips are chosen

`manifest.json` lists clips as `{ file, start, end, weight }` (times in seconds). At runtime each clip is cut out, faded in and out, and normalized. Short clips play for light toots, medium clips for normal blasts and long clips for full-power blasts. Playback speed drops slightly for bigger blasts. If no clips load, the game falls back to a synthesized fart.

## Using your own recordings

1. Drop `.wav`, `.mp3` or `.ogg` files in this folder. Use clips you have the rights to.
2. Add entries to the `clips` list in `manifest.json`. Leave `start` and `end` off to use a whole file.
3. Remove the clips you don't like. The clip times were picked automatically by loudness, so some may not sound like farts to you.
