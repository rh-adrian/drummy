# PROTOTYPE: can the chat AI turn real tabs into exact song grooves?

Throwaway code for issue #7 on the song-tab map (issue #3). It lives only on the
`prototype/song-tab-transcription` branch and is never merged. The verdict is recorded on
issue #7.

## The question

Give a chat AI a real drum tab and drummy's tool manual. Can it write song grooves (a `main`
section plus other named sections) that:

- pass drummy's groove validation, as `save_song` would check them,
- sound like the record when drummy plays them,
- fit drummy's groove format (1 to 4 bars, 8/12/16/24/32 steps per bar, one tempo)?

And does the AI do better from the tab's text or from a screenshot of it?

## How it was run

1. Fetch a few real tab pages with Camoufox: rendered text plus screenshots. **Keep them out
   of git.** They are third-party content.
2. Dump the manual the AI sees: `npx tsx prototypes/song-tabs/dump-manual.ts > manual.md`
3. Give two fresh AI agents the same brief and manual. One gets only the tab text, the other
   only the screenshots. Each writes one song file per song and checks it with:
   `npx tsx prototypes/song-tabs/check.ts <song.json>`
4. Record every section through the real page and kit:
   `FFMPEG=/path/to/ffmpeg npx tsx prototypes/song-tabs/render.ts <clips-dir> <songs-dir>...`
5. A person listens and rates each clip against the record.

## Song file shape (a draft of `save_song`'s input)

```json
{
  "artist": "...", "title": "...", "tabUrl": "...",
  "sections": { "main": { "...a play_groove groove..." }, "chorus": { } },
  "notes": { "tempoSource": "", "didNotFit": [], "couldNotRead": [], "soundsLikeRecord": "", "checkRuns": 0 }
}
```

Song files and clips hold real tab content, so they never go in git.
