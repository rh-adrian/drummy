# Drum tab sites: coverage, ratings and readable text

Research for issue #4 ("Which tab sites have drum tabs, ratings and readable text?") on the
song-tab map, issue #3. Checked on **2026-10-25**.

This note describes what each site has and how its pages are built. It does not pick sites or
an order. That is issue #8. It also does not settle how `find_song_tab` gets past search
engines. That is issue #6.

No real tab is copied here. Every tab line in this file is made up to show a format.

## How this was checked

- **Sites:** each site's own pages, search pages and robots.txt. Where a site loads its data
  as JSON, the JSON was read too. A few search queries found the candidate sites.
- **Fetching:** one page at a time, a few seconds apart. About 90 requests in all, mostly
  search pages and small API calls. Everything came from one datacenter IP. Plain HTTP requests came first. Pages that needed a real browser
  were loaded in Camoufox, the stealth Firefox build that `find_song_tab` plans to use.
- **Songs:** ten songs with famous drum parts: Brick House (Commodores), Billie Jean (Michael
  Jackson), Back in Black (AC/DC), Rosanna (Toto), Superstition (Stevie Wonder), When the Levee
  Breaks (Led Zeppelin), Smells Like Teen Spirit (Nirvana), Funky Drummer (James Brown), Seven
  Nation Army (The White Stripes) and Take Five (Dave Brubeck).
- **Notation:** read in seven real text tabs: three from Ultimate Guitar, three from tTabs and
  one from GuitareTab. Wikipedia's drum tablature article filled in the symbols those tabs
  didn't use.

## Short answer

- **Text drum tabs with ratings** live on three sites: **Ultimate Guitar**, **tTabs** and
  **GuitareTab**. All three show a 5-star rating and a vote count on the tab page. Ultimate
  Guitar and tTabs also show both numbers in their search results.
- **Songsterr** had a drum part for **all 10 songs**. But it is drawn notation, not text, and it
  has **no ratings**. Behind the drawing is clean JSON data: every note, its timing, the
  time signature, the tempo and the section names.
- Text tabs existed for only **6 of the 10 songs**. Funk, soul and jazz were missing: Brick
  House, Rosanna, Superstition and Take Five had no text drum tab on any site checked.
- In 3 Google searches, **no snippet for a tab page showed a rating**, and **Ultimate Guitar's
  drum tabs never made the top 10**. Songsterr filled most results. One DuckDuckGo search
  gave a better mix, including the Ultimate Guitar drum tab.
- None of the text-tab sites challenged automated requests at this slow pace. **MuseScore**
  blocked every automated route we tried.
- Text tab notation is loose. Letters change meaning from tab to tab: `X` can mean accent,
  crash or open hi-hat, and `f` can mean flam or hi-hat foot. Each tab's own legend matters.

## 1. Per-site comparison

| Site | Drum tabs? | Rating + vote count | Text or drawn | Data behind the page | Bot protection seen |
|---|---|---|---|---|---|
| **Ultimate Guitar** (`tabs.ultimate-guitar.com`) | Yes, type "Drum Tabs". Mostly rock. 0–3 per song in our list | Yes. On the page, in its search results, in page JSON and in schema.org JSON-LD | **Text** (ASCII) | Page JSON holds the tab text, `rating` and `votes` | Cloudflare in front. No challenge for plain requests or Camoufox at 1 request every 4 s |
| **Songsterr** (`songsterr.com`) | Yes. A drum track for all 10 songs, plus many user variants | **No ratings.** Has view counts per track, favourites per song and a "junk" flag | **Drawn** (SVG notation) | Yes. A JSON search API, plus per-track JSON with notes, timing, time signature, tempo and section text | None seen. robots.txt disallows `/api/` |
| **tTabs** (`ttabs.com`) | Yes. Up to 20 per song for rock hits | Yes, as plain text: "3.3 out of 5. Rated 20 times." On the tab page and in search results | **Text** in a `<pre>` block | None (plain HTML) | None seen. robots.txt disallows `/tabs.php`, the tab pages themselves |
| **GuitareTab** (`guitaretab.com`) | Yes. "drum" versions, 0–3 per song | On the tab page only: JSON-LD (`ratingValue`, `reviewCount`) and star images. Search shows hit counts only | **Text** in a `<pre>`, one `<span>` per row | JSON-LD rating only | None seen |
| **911tabs** (`911tabs.com`) | Index only. Links to other sites' drum tabs | Shows stars and counts for linked tabs | n/a (links out) | n/a | None seen. **Index is stale**: both of its guitartabs.cc drum links were 404 |
| **drumtabs.app** | Yes, but small: 118 tabs in its sitemap, 2 of our 10 songs | None found | **Drawn**: an HTML grid with a player. Page text is not line-shaped | Yes. Structured measures and tempo inside the Next.js page data | None seen |
| **MuseScore** (`musescore.com`) | Yes, user drum scores (seen in search results) | Not verified (blocked) | **Drawn** sheet music | Not verified | **Cloudflare challenge** blocked plain requests, Camoufox, a stealth Chromium on a residential connection, and a third-party fetcher |
| Paid or lesson sites (OnlineDrummer, Drumscore, Drumeo, Melodics, Scribd PDFs and others) | Transcriptions as PDFs, sheet music or lessons | Scribd showed "Rating 5.0 (1)" in Google | Drawn or PDF | Not checked | Not checked. Paywalls or downloads |

**Gone or not tab hosts:** drumtabs.org now redirects to a link directory on drumming.com.
Most links in that directory, and on other "drum tab links" pages, point at dead sites such as
mxtabs, tabcrawler and tripod pages. tTabs looks like a survivor of the old mxtabs catalogue:
its robots.txt still lists an `mxtabsuser.php` page.

### Ultimate Guitar details

- **Finding drum tabs:** the search page takes a type filter. Drums is `type=700`. When nothing
  matches, the page returns **HTTP 404** with `not_found: true` in its data. A tool must read
  that as "no tabs", not as an error or a block.
- **The page data:** every page embeds its data as JSON in a `div.js-store` element
  (`data-content`). Search results list `type` ("Drum Tabs"), `rating` (for example 4.41),
  `votes` (122), `version` and `tab_url` for each tab. So you can rank tabs from the search page
  alone.
- **On a tab page:** the same JSON holds `tab.rating`, `tab.votes` and the full tab text in
  `tab_view.wiki_tab.content`. The text wraps each block in `[tab]…[/tab]`.
- **Where a person sees the rating:** below the tab ("Rating 4.1, 85 rates") and in the
  "More Versions" sidebar ("★ 4.1 (85)").
- **For machines:** the page also has schema.org JSON-LD with an `AggregateRating`
  (`ratingValue`, `ratingCount`). That block is a standard format, not this site's own class
  names.
- **Watch out:** the sidebar also lists the paid "Official" tab, with a far bigger vote count
  (4.8 from 5.7K on the Teen Spirit page). That tab is drawn, multi-instrument and paywalled.
  A naive "highest rated" pick would choose it.
- **robots.txt:** disallows `/search.php` for crawlers. Tab pages are allowed.

### Songsterr details

- **Search API:** `/api/songs?pattern=<text>` returns JSON. Each song lists its tracks.
  `instrumentId: 1024` is drums. Each track has `views` and `difficulty`. Each song has
  `isJunk`, and its meta adds `favoritesCount`, `aiGenerated` and the author. There is **no
  rating field**.
- **Many "songs" per real song:** user uploads appear as separate songs, such as "Brick House
  2.0", "(Bass Highlighted Version)" and "(AI)". The main one usually has by far the most views.
- **Behind the drawing:** the tab page fetches one JSON file per track from a CDN.
  - Each file lists measures, then beats. Each beat has a `duration` as a fraction, notes with
    a General MIDI drum number in `fret` (38 = snare), a `velocity` mark such as `f`, and
    section text such as "INTRO".
  - Each measure has a `signature` such as `[4, 4]`.
  - `automations.tempo` gives the BPM (108 on Brick House).
  - Compared with any text tab, this is exact data.
- **Viewing:** free, with no login needed to see a tab. Speed control, looping, printing and
  downloading are locked behind the paid "Plus" plan.
- **Shape detection:** the page text has nothing tab-shaped: 42 SVGs, no `<pre>` blocks. A
  detector that looks for lines like `HH|x-x-|` finds nothing here.

### tTabs and GuitareTab details

- **tTabs:** a plain, old HTML site. The tab text sits in one `<pre>` block. The rating is
  ordinary text on the page: "rated: Quality: 4.43 out of 5. Rated 7 times." Search
  (`search.php?search=<title>&for=piece`) lists every tab with its instrument ("Drums tab"),
  rating and vote count.
- **GuitareTab:** the tab sits in a `<pre>`, but each row is its own `<span>`. Stripping the
  HTML tags joins rows onto one line, and section names stick to the next row
  ("ChorusC |----"). The browser's rendered text (`innerText`) keeps the lines apart. So read
  rendered text, not raw HTML.
- **Album tabs:** one GuitareTab "Back In Black drum" tab is the whole album in one file, about
  600 lines with ten songs. The song you want is one part of it.
- **Same tab, two sites:** the most-voted Ultimate Guitar Back in Black drum tab and one tTabs
  Back in Black tab have the **same 86 drum rows**. Each site credits a different tabber and
  shows a different rating: 4.51 from 31 votes on Ultimate Guitar, 3.3 from 20 on tTabs. A
  rating belongs to the listing, not to the tab text.

## 2. Coverage on 10 songs

The "Text tabs" columns count drum tabs by the right artist. They were found with each site's
own search. Ratings are out of 5, written "rating / votes". Songsterr shows the drum-track
views on the main upload.

| Song | Ultimate Guitar | tTabs | GuitareTab | Songsterr (drawn) | drumtabs.app |
|---|---|---|---|---|---|
| Brick House – Commodores | 0 | 0 | 0 | yes, 5,960 views | no |
| Billie Jean – Michael Jackson | 0 | 2 (best 4.1 / 42) | 0 | yes, 30,076 views | no |
| Back in Black – AC/DC | 3 (best 4.51 / 31) | 8 (most votes: 3.83 / 355, 4.16 / 329) | 3 (one is a whole-album tab) | yes, 368,372 views | no |
| Rosanna – Toto | 0 | 0 | 0 | yes, 41,940 views | no |
| Superstition – Stevie Wonder | 0 | 0 | 0 | yes, 25,351 views | no |
| When the Levee Breaks – Led Zeppelin | 1 (no votes) | 1 (4.79 / 28) | 1 | yes, 71,664 views | no |
| Smells Like Teen Spirit – Nirvana | 1 (4.08 / 85) | 11 (most votes: 3.95 / 1,446) | 1 | yes, 348,570 views | yes |
| Funky Drummer – James Brown | 0 | 1 (4.43 / 7, the "Bonus Beat Reprise" version) | 0 | yes, 660 views (1,110 on the "Bonus Beat Reprise" upload) | no |
| Seven Nation Army – The White Stripes | 3 (best 4.41 / 122) | 20 (most votes: 4.0 / 279) | 1 | yes, 190,535 views | yes |
| Take Five – Dave Brubeck | 0 | 0 | 0 | yes, 16,764 views | no |
| **Songs covered** | **4 / 10** | **6 / 10** | **4 / 10** | **10 / 10** | **2 / 10** |

What this shows:

- **Any text tab:** 6 of 10 songs. Rock songs are well covered. Funk, soul and jazz are not.
  Three of the four misses are among the most famous drum grooves there are.
- **Ultimate Guitar coverage:** we cross-checked one miss on the artist page. Michael
  Jackson's page, filtered to drums, lists exactly one drum tab ("Beat It"), so Billie Jean
  really is missing.
- **Vote scales differ a lot.** tTabs has tabs with over 1,000 votes (possibly carried over
  from older sites). Ultimate Guitar's best drum tab in our list has 122. GuitareTab's Back in
  Black drum versions have 3 or 4 each.
- **Wrong versions:** search turns up live versions, "Bonus Beat Reprise" versions and
  whole-album tabs. The tool has to check that a tab is the song it asked for.

## 3. What search results look like

### Google

We ran three Google searches in Camoufox from a datacenter IP:
"Back in Black AC/DC drum tab", "Smells Like Teen Spirit Nirvana drum tab" and
"Seven Nation Army The White Stripes drum tab".

- **No captcha.** But Google served its basic, no-JavaScript results page, with a "retry with
  JavaScript" link.
- **Hidden links:** on that basic page, every result links through `/url?q=<opaque token>`. The
  real address is not in the link. The page only shows a shortened breadcrumb like
  "www.songsterr.com › Nirvana". Getting the address means either following the redirect
  (one more request to Google) or rebuilding it from the breadcrumb.
- **What ranked:**
  - Songsterr filled 2 to 7 of the 10 results, mostly user variants such as "(Drop D)",
    "(but its all BASS)" and "D standard … by dracaena", not the main tab.
  - YouTube lessons filled most of the rest.
  - PDF and lesson sites made up the remainder: Scribd, nicksdrumlessons, thedrumninja,
    dddrums and playdrumsonline.
  - **Ultimate Guitar's drum tabs never appeared in the top 10**, even for Teen Spirit (85
    votes) and Seven Nation Army (122 votes).
- **Ratings in snippets:** only one result, a Scribd PDF, showed one ("Rating 5.0 (1)"). No tab
  site's snippet showed a rating. So ratings must come from the tab page or the site's own
  search, not from Google.

### DuckDuckGo (HTML version)

We ran one search: "Smells Like Teen Spirit Nirvana drum tab", as a plain request to its HTML
results page.

- **Direct addresses:** each result carries the real address, in a `uddg=` parameter.
- **Better results:**
  - Songsterr's **main** drum tab came first, a Songsterr beginner version came second, and
    the Ultimate Guitar drum tab came third.
  - The rest were drumtabs.app, two MuseScore scores, supersimpledrum, drumivo, a lesson site
    and a Scribd PDF.
- **Ratings in snippets:** none. The Ultimate Guitar snippet showed views, saves and comments,
  not the rating.

All results came from one place and one IP. A user at home may see different results.

## 4. ASCII drum tab notation: what to expect

These variants come from the seven text tabs read for this note. Wikipedia's drum tablature
article adds the conventions marked *(Wikipedia)*.

### Row shape

A row is a label, an optional space, a pipe, then cells, with a pipe between bars. Made-up
example:

```
SD |----o-------o---|----o-------o-o-|
```

- **Padding:** some tabs pad the label with spaces (`S  |`). Some add a colon in the legend.
  Some put the legend at the top, some at the bottom, some leave it out.
- **Cells per bar vary,** even inside one tab. 16 cells (16th notes) is by far the most common.
  8-cell bars (8th notes) appear next to 16-cell bars in the same tab. A detector must not
  assume one bar width.
- **Text beside rows:** some tabs put text to the right of a row, such as a repeat count or a
  note ("Repeat …").

### Drum labels seen

| Part | Labels seen |
|---|---|
| Hi-hat | `H`, `HH`, `Hh` |
| Hi-hat (foot) | `Hf`, `HF`, `F` (one tab's legend: "F = hi-hat w/ Foot"); *(Wikipedia)* `FH` |
| Crash | `C`, `CC` |
| Ride | `R`, `Rd` |
| Snare | `S`; *(Wikipedia)* `SN`; common in the wild: `SD` |
| Bass drum | `B`; *(Wikipedia)* `BD` |
| Toms | `T`, `T1`, `t1`, `t2`; *(Wikipedia)* `T2` |
| Floor tom | `F`, `Ft`; *(Wikipedia)* `FT` |

`F` is ambiguous. It meant floor tom in one tab and hi-hat foot in another. Only the tab's
legend tells you which.

### Hit letters seen

| Letter | Meanings seen |
|---|---|
| `x` | cymbal or hi-hat hit (closed hat); hi-hat foot click *(Wikipedia)* |
| `o` | drum hit (snare, bass, toms); **open hi-hat** on a hi-hat row in two tabs |
| `X` | crash hit (Seven Nation Army tab); **open hi-hat** (Funky Drummer tab: "X = open Hi-Hat"); loose hat or hard crash *(Wikipedia)* |
| `O` | accent *(Wikipedia)*; open hat or accent in drumtabs.app's grid |
| `g` | ghost note (Funky Drummer tab); *(Wikipedia)* the same |
| `f` | **flam** on a snare row; **hi-hat foot** on a hi-hat row (Seven Nation Army tab: "H = Hi-Hat (o = open, x = close, f = foot)") |
| `*` | footnote marker. One tab marks an unclear triplet with `**` and explains it in a note |
| *(Wikipedia only)* | `#` choke, `s` splash, `c` china, `b` ride bell or soft roll, `B` accented roll, `d` drag, `@` snare rim |

**This matters for drummy.** Drummy's grid letters mean *how loud*: `X` accent, `x` normal,
`o` soft, `g` ghost (and `O` is accepted as an accent). Tab letters mostly mean *which sound*.
The clearest trap is `o`. In a tab, `o` is the normal snare or bass hit, but in drummy it
means soft. Copying it across would play the whole backbeat quietly. The AI must read each
tab's legend and map letters to drummy's kit and velocity.

### Repeats

- **Right of a row:** a count like `x2`, `x4` or `x6` at the end of one of the rows, or on
  its own line under the block.
- **Bracket above bars:** `<------x3------>` over the bars to repeat. Brackets can be stacked:
  an outer `x5` with two inner `x3` spans.
- **Word bracket:** `/------Play x3------` above the block.
- **Endings:** `1.` and `2.` written above bars (first and second ending).
- **Back-reference:** a section name or timestamp with no rows under it ("1:39 [VERSE]") means
  "play that section again".
- **Free text:** "Outro (repeat to end)", "Repeat in 4:20 minutes ;)".

### Triplets

- **Bracket:** a `|___|` bracket under a few cells, with a `3` under it (Seven Nation Army
  tab). Made-up example:

  ```
  S |----o-------ooo-|
                 |_|
                  3
  ```

- **Footnote:** `**` columns with a note such as "Mysterious triplet on either the tom, the
  bass drum…" (Teen Spirit tab).
- **Not seen:** 12- or 24-cell bars used as a triplet grid. Wikipedia doesn't cover triplets.
  Swing or shuffle is usually just described in words ("kind of 'shuffle' groove").

### Time signature and tempo

- **Time signature:** only one of seven tabs stated it ("Time Sig.: 4/4", in a header). The
  rest leave it out. You have to infer it from cells per bar and the count row. No text tab
  was found for Take Five (5/4), so odd meters were not seen in text form. Songsterr's JSON
  gives the time signature on every measure.
- **Tempo:** only two of seven gave a BPM: "approx 110 bpm" and "Bpm: 192". Others give words
  only ("slow tempo right down"). Treat any number as a hint. The 192 BPM figure on the Funky
  Drummer tab is about double the usual count for that groove. For Teen Spirit, the tab says
  about 110, a commenter says 116, and drumtabs.app says 115.

### Section labels

- **Square brackets:** `[Verse 1]`, `[Chorus]`, `[Bridge in]`.
- **Timestamps:** `[0:00]`, `0:25 [VERSE]`, `[1:06 CHORUS]`, `(0.00)`.
- **Bare words before a block:** `Intro`, `Main`, `Verse2`, `Chorus3`, `Fill`, `Interlude`.
- **Cue lines:** "Bass comes in…", "Singing…", "Intro (when guitar begins)".
- **Song headers:** whole-album tabs separate songs with lines like
  `----------Track 1----------`.

### Count rows

A row of counts under the drum rows, with no drum label. Made-up examples:

```
    1 + 2 + 3 + 4 + |1 + 2 + 3 + 4 + |
  |1e+a2e+a3e+a4e+a|
```

A parser must not mistake these for a drum. They are useful, though: they give the grid
resolution and help infer the time signature.

### Other things to expect

- **Wrappers:** Ultimate Guitar wraps blocks in `[tab]…[/tab]`. The first row can sit on the
  same line as `[tab]`.
- **Legends:** the legend can be at the top ("Key:"), at the bottom, or missing. It is often
  `H = Hi-hat (x=closed, o=open)` style.
- **Typos:** a `0` (zero) used for `o`.
- **Prose and comments:** chatty notes, lyrics and comments mixed between blocks.

## 5. Facts the later tickets will need

These are findings, not decisions.

- **For #8 (sites and fallback order):**
  - Only Ultimate Guitar, tTabs and GuitareTab give text plus a rating.
  - Songsterr gives the best coverage and the most exact data, but has no rating and no text.
    Its view count is the only popularity signal.
  - Google ranked Songsterr variants and lessons, not text tabs, in all 3 searches. A site's
    own search found the text tabs every time.
  - Both search pages that robots.txt blocks (Ultimate Guitar's `/search.php`, Songsterr's
    `/api/`) are crawler rules. Whether a user-triggered lookup should respect them is a
    policy call.
  - tTabs disallows its tab pages in robots.txt.
- **For #9 (what `find_song_tab` hands back):**
  - Ratings from different sites are not comparable. The same tab text carried different
    ratings on two sites. Vote scales differ by 100×.
  - schema.org `AggregateRating` JSON-LD is a site-independent way to read a rating, on
    Ultimate Guitar (`ratingCount`) and GuitareTab (`reviewCount`). tTabs needs a text pattern
    ("N out of 5. Rated N times").
  - Ultimate Guitar's paid "Official" tab must not win the rating contest.
- **For the shape detector:**
  - Read the browser's rendered text. Raw HTML can glue rows together (GuitareTab).
  - Accept bar widths other than 16, labels of 1–3 characters with optional padding, and count
    rows without labels.
  - Whole-album tabs need the right song cut out.
- **For #7 (can the AI transcribe real tabs):**
  - Letters change meaning between tabs.
  - Triplets are drawn as brackets or footnotes.
  - Time signatures are rarely written down.
  - Tempos in tabs can be off by 2×.

## 6. Could not verify

- **MuseScore:** how it shows ratings and vote counts, and whether score data sits behind its
  sheet music. Every automated fetch hit a Cloudflare challenge. That included Camoufox on a
  datacenter IP and a stealth Chromium on a residential connection. It may load in a normal
  desktop browser. We didn't test that.
- **Google beyond one look:** whether Google always serves the basic page, or shows a captcha
  after more searches, or shows different results from a home connection. We ran three
  searches from one datacenter IP. Issue #6 covers this.
- **Rate limits:** how much traffic each site allows before it starts challenging. We stayed
  near one request every 4 seconds and saw no challenge on the text-tab sites.
- **Small or paid sites:** OnlineDrummer, Drumscore, Drumeo, TheDrumNinja, supersimpledrum,
  drumivo, Soundslice and Scribd were seen in search results or link pages but not opened.
  They are PDF, paid, lesson or drawn formats, so they are unlikely sources of text tabs.
- **Ultimate Guitar's Guitar Pro tabs:** these are full arrangements played in its own player,
  and may include a drum track. We didn't check them.

## Sources

All checked on 2026-10-25.

- **Ultimate Guitar:**
  - Drum-type search: https://www.ultimate-guitar.com/search.php?title=Back+in+Black&type=700
  - Search with no drum results (404 + `not_found`): https://www.ultimate-guitar.com/search.php?title=Brick+House&type=700
  - Tab pages:
    - https://tabs.ultimate-guitar.com/tab/acdc/back-in-black-drums-859472
    - https://tabs.ultimate-guitar.com/tab/nirvana/smells-like-teen-spirit-drums-859029
    - https://tabs.ultimate-guitar.com/tab/the-white-stripes/seven-nation-army-drums-859580
  - Artist page filtered to drums: https://www.ultimate-guitar.com/artist/michael_jackson_10582?filter=drums
  - robots.txt:
    - https://www.ultimate-guitar.com/robots.txt
    - https://tabs.ultimate-guitar.com/robots.txt
- **Songsterr:**
  - Search API: https://www.songsterr.com/api/songs?pattern=brick%20house%20commodores
  - Song meta: https://www.songsterr.com/api/meta/32649
  - Tab page: https://www.songsterr.com/a/wsa/commodores-brick-house-drum-tab-s32649t0
  - Track JSON, as fetched by that page: https://dqsljvtekg760.cloudfront.net/32649/7808916/v0-3-2-AGNQcchoy1hqujT_/0.json
  - robots.txt: https://www.songsterr.com/robots.txt
- **tTabs:**
  - Tab pages:
    - https://www.ttabs.com/tabs.php?id=97802
    - https://www.ttabs.com/tabs.php?id=237743
    - https://www.ttabs.com/tabs.php?id=257886
  - Search: https://www.ttabs.com/search.php?search=Brick+House&for=piece
  - robots.txt: https://www.ttabs.com/robots.txt
- **GuitareTab:**
  - Tab page: https://www.guitaretab.com/a/ac-dc/193407.html
  - Search: https://www.guitaretab.com/fetch/?type=tab&query=superstition
  - robots.txt: https://www.guitaretab.com/robots.txt
- **911tabs:**
  - Drum page: https://www.911tabs.com/tabs/a/ac_dc/drum_tabs/back_in_black_drum_tab.htm
  - Dead link it points to: https://www.guitartabs.cc/tabs/a/ac_dc/back_in_black_album_drum_tab.html
- **drumtabs.app:**
  - Tab page: https://drumtabs.app/tabs/LN1f9CBl/nirvana-smells-like-teen-spirit
  - Sitemap: https://drumtabs.app/sitemap.xml
- **MuseScore** (blocked): https://musescore.com/user/9111646/scores/5151823
- **drumtabs.org** (redirects to a directory): https://www.drumming.com/drum-lesson/drum-tabs
- **Link hub:** https://tigerbill.com/drumtabs.htm
- **Wikipedia, drum tablature:** https://en.wikipedia.org/wiki/Drum_tablature
- **Search engines:**
  - Google, the three queries above at `https://www.google.com/search?q=…`
  - DuckDuckGo HTML: https://html.duckduckgo.com/html/?q=Smells+Like+Teen+Spirit+Nirvana+drum+tab
