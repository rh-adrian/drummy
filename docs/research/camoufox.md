# Camoufox for `find_song_tab`: licences, download, install checks

Researched 2026-10-25. Every claim cites a primary source (repo files at a named commit or tag, registry metadata, release API, licence texts). [M] marks our own measurement on 2026-10-25: a Linux x86_64 server with Node 22.22 and npm 10.9, which installed the packages, ran each `fetch`, and launched the browser headless. Anything we could not confirm is marked **unverified**.

## Answer in brief

- **Home.** Camoufox still lives at `github.com/daijro/camoufox`. The browser is MPL-2.0. The repo is active: the last push was 2026-10-25 [1][2]. Of the last 100 commits, 77 are by JWriter20 and 1 is by daijro. JWriter20 is also the only npm maintainer of the `camoufox` package [11]. The launcher's repo list also names a `camoufox/camoufox` repo as a fallback. That GitHub org exists but has no public repos [13]. We could not confirm whether ownership formally changed (**unverified**).
- **There are now two Node wrappers.** A "wrapper" is the library that downloads the browser and launches it with a fake device identity.
  - `camoufox` on npm is the **official** one. It is MIT-licensed, version 0.5.8 from 2026-10-06, and is built in the browser repo with npm provenance, which is a signed record of the source commit it was built from [11][12].
  - `camoufox-js` is Apify's port. It is MPL-2.0, version 0.13.0 from 2026-10-16 [15][16].
  - Both need Node 22 or newer. The official package needs 22.15 or newer. drummy declares Node >= 20, and Node 20 reached end of life on 2026-04-30 [35].
- **The AGPL lead is confirmed.** Both wrappers depend on `ua-parser-js` 2.0.10, which is **AGPL-3.0-or-later**. The 1.x line was MIT. No other package in either dependency tree is copyleft, except `camoufox-js` itself, which is MPL-2.0 [18][M].
- **Verdicts on keeping the repo MIT:**
  - A, an `optionalDependencies` entry: **yes, with conditions**.
  - B, installing the wrapper at runtime on first use: **yes**. This is the option shaped most like D-7.
  - C, downloading the zip ourselves and launching it with Playwright: **yes**.
  - D, bundling or vendoring: **no**.
- **The download is large.**
  - The official wrapper is paired with browser build `156.0.1-beta.36`. Its zip is about **1.29 GB** on every platform and unpacks to about **2.5 GB**. More than 2 GB of that is fonts for all three operating systems. `fetch` adds about 340 MB on disk of extras.
  - `camoufox-js` 0.13.0 is paired with `152.0.4-beta.30`. That zip is **313 MB on Apple Silicon** (670 MB unpacked) and **663 MB on Linux x86_64** (1.28 GB unpacked) [3][4][6].
  - Apple Silicon builds exist for the current line.
- **The cache directory is the same for both wrappers.** It is `~/Library/Caches/camoufox` on macOS. On Linux it is `$XDG_CACHE_HOME/camoufox`, or `~/.cache/camoufox` when that is unset. Each build goes in `browsers/official/<version>-<build>-<sha8>/`, and `config.json` holds `active_version` [12][16][M].
- **Search engines let it through.** From a datacenter IP (the worst case), with no proxy, 15 of 15 headless Camoufox searches got real results: Google 5, Bing 5, DuckDuckGo HTML 5. No CAPTCHA, "unusual traffic" or consent page appeared. The sample is small, so this is not a block rate. A plain `curl` got a JavaScript wall from Google and a CAPTCHA from DuckDuckGo, so the real browser is what makes the difference. Details, detection signals and result-link formats are in [Search-engine probe](#search-engine-probe).
- **Launching the raw binary without a wrapper reveals the browser.** The user agent reads `… Gecko/20100101 Camoufox/156.0.1-beta.36` [M]. Both wrappers produce an ordinary Firefox user agent.
- **Not verified:**
  - whether ownership of the repo formally moved;
  - whether files that Node downloads on macOS get the Gatekeeper quarantine flag;
  - whether the macOS app is notarized;
  - the exact text of the macOS "can't be opened" dialog;
  - the separate terms of each GeoIP data source and of the fpgen model data;
  - download and unzip speed on a real home Mac.

## Licenses

| Component | Version | Date | License | Source |
|---|---|---|---|---|
| Camoufox browser (`daijro/camoufox`, the `browser/` tree) | v156.0.1-beta.36 (latest stable); v158.0-beta.40 (latest prerelease) | 2026-10-06; 2026-10-19 | MPL-2.0 | [1][2][3][5] |
| Firefox, which Camoufox patches | 156 | — | Mostly MPL-2.0. Firefox's `LICENSE` points to `about:license` for the full list of third-party licences | [29][1] |
| Cursory mouse-movement data, compiled into the browser | in the source at tag v156.0.1-beta.36 | — | LGPL-3.0-or-later | [9] |
| Fonts inside the release zip | "font-bundle-v1", in releases since 2026-09-24 | 2026-09-24 | **Proprietary third-party fonts** sit alongside open ones. The zip holds Apple's SF, Helvetica, Apple Color Emoji and PingFang, plus Arial. The project's disclaimer says the fonts are used "solely for academic and research purposes" and that "No commercial use or distribution of these fonts is intended or permitted". The project removed Adobe's fonts because "Adobe permits no redistribution". | [7][6] |
| uBlock Origin ("uBO", an ad blocker the launchers add by default) | 1.75.0 | 2026-09-16 | GPL-3.0-only | [25] |
| GeoIP database used by the official launcher ("GeoIP AIO") | 2026.10.21 | 2026-10-21 | The build repo is GPL-3.0. The data merges IP2Location LITE, GeoLite2 and DB-IP Lite, and the README lists only attribution lines for them. Each source's own terms are **unverified** here. | [26] |
| GeoLite2-City database used by `camoufox-js` (mirrored by P3TERX) | daily | — | MaxMind GeoLite2 EULA plus CC BY-SA 4.0, according to that repo's README | [27] |
| fpgen device model, downloaded by the official launcher | `model-2/2026` | — | The fpgen code is Apache-2.0. The model data "remains under its upstream terms", which are not stated further (**unverified**). | [13][28] |
| Python `camoufox` (shown for comparison) | 0.5.8 | 2026-10-06 | MIT. It uses the Apache-2.0 Python `ua_parser`, not the AGPL `ua-parser-js` | [14] |
| npm `camoufox` (the official TypeScript launcher) | 0.5.8 (`latest`); 0.5.9-beta.5 (`next`) | 2026-10-06 | MIT. It includes an Apache-2.0 port of fpgen and BSD/MIT notices. Versions 0.1.x (2025) were a different project, `tocha688/camoufox-js` | [11][12][13] |
| npm `camoufox-js` (Apify) | 0.13.0 | 2026-10-16 | MPL-2.0 | [15][16] |
| `ua-parser-js`, a dependency of both wrappers | 2.0.10 (`latest`). 1.0.41 is tagged `legacy` | 2026-05-21 | **AGPL-3.0-or-later** since 2.0.0 (2024-11-18). Version 1.0.41 is MIT. Paid "PRO" licences are offered | [18] |
| `impit`, a native Rust HTTP client used by both wrappers | 0.14.7 | — | Apache-2.0. Ships prebuilt binaries as per-platform optional packages | [M] |
| `better-sqlite3` (`camoufox-js` only) | 13.0.3 | — | MIT. Ships prebuilt `.node` files for darwin-arm64/x64, linux(-musl)-arm64/x64 and win32-arm64/x64, so nothing is compiled at install. It has no install script and needs Node >= 22 | [19] |
| `fingerprint-generator` and `header-generator` (`camoufox-js` only) | 2.1.89 | — | Apache-2.0 | [M] |
| `playwright` / `playwright-core` | 1.64.1 is the latest. The wrappers need a version below 1.63, so in practice 1.62.1 | 2026-10-14; 2026-07-30 | Apache-2.0 | [20] |

**Dependency trees from `npm install` [M].**
- `camoufox@0.5.8` installs 33 packages, about 35 MB including `playwright-core`.
- `camoufox-js@0.13.0` installs 60 packages, about 74 MB, of which `better-sqlite3` is 27 MB.

The licences in both trees are MIT, ISC, Apache-2.0, BSD-3-Clause, BlueOak-1.0.0, 0BSD, CC0-1.0 and CC-BY-4.0. The CC-BY-4.0 one is the `caniuse-lite` data, in `camoufox-js` only. The only copyleft licences are `ua-parser-js` (AGPL) and `camoufox-js` itself (MPL).

**Which Playwright version works.** Both wrappers declare a peer dependency (a package you install yourself next to theirs) of `playwright-core <1.63`. The reason given is that "every Playwright minor is free to change Juggler", where Juggler is Firefox's automation protocol that Playwright talks to [12][14]. Playwright 1.61 and newer need browser build beta.30 or later. Older builds fail with `Protocol error (Browser.setDefaultViewport)` [12]. drummy's lockfile pins `playwright` 1.62.0, which is in range. Its `^1.62.0` range would float to 1.64 on a fresh install, so it should be `~1.62.0`.

**The licence texts that matter.**
- **MPL-2.0 [2][21]** is "file-level" copyleft. Only files that contain MPL code ("Modifications", §1.10) must stay MPL.
  - Duties start when you distribute: §3.1 for source form, and §3.2 for executable form, which requires you to make the source available.
  - §3.3 "Larger Work" lets you combine MPL files with other files under "terms of Your choice".
  - Running the software or downloading it for yourself creates no duty.
- **AGPL-3.0 [18][22]** separates three acts.
  - To "propagate" is to copy or distribute, "except executing it on a computer or modifying a private copy".
  - To "convey" is propagation "that enables other parties to make or receive copies".
  - §2 says: "You may make, run and propagate covered works that you do not convey, without conditions".
  - §13, the network clause, applies only "if you modify the Program". drummy would not modify `ua-parser-js`.
- **GPL-3.0 [23]** is the licence of uBO. Its definitions and §2 match the AGPL above. It has no network clause.
- **Apache-2.0 [24]** applies to Playwright. Its duties in §4 start only when you redistribute.

## Integration options and MIT verdicts

D-7 is the precedent. Strudel (AGPL-3.0) is loaded by the user's browser from a CDN at runtime. It is never bundled, vendored, statically imported or redistributed, so the repo stays MIT.

| Option | What ends up where | Repo stays MIT? | One-line reason | Compared with D-7 |
|---|---|---|---|---|
| **A.** `camoufox` or `camoufox-js` in `optionalDependencies` | `package.json` names it. npm fetches it, and the AGPL `ua-parser-js`, into the user's `node_modules` at install time. Nothing lands in the repo or the npm tarball (drummy's `files` field is `dist` and `page`). | **Yes, with conditions** | A dependency entry is not a copy. The conditions: no `bundleDependencies`, load it only through `import()`, and accept that every `npm install drummy` now fetches AGPL code and a package that needs Node 22, even for users who never use the tool. | Weaker than D-7. The fetch happens at install for every user, not on first use, which breaks the settled "downloaded on first use" rule. |
| **B.** Not in `package.json`. On first use drummy runs `npx camoufox@0.5.8 fetch` (or `camoufox-js@0.13.0`), or installs the pinned wrapper into a folder it owns and loads it with `import()` | The user's machine fetches the wrapper from npm and the browser from GitHub at runtime. drummy ships only a version string. | **Yes** | drummy conveys no MPL, AGPL or GPL code. Code runs on the user's machine, which is "run", not "convey" (AGPL §2). | Same shape as D-7: fetched at runtime by the user's machine, joined only at runtime. |
| **C.** No wrapper. drummy downloads the release zip from GitHub and calls `firefox.launch({ executablePath })` | `playwright` moves from `devDependencies` to a dependency or optional dependency. It is Apache-2.0, which is fine in an MIT repo. The MPL browser is downloaded to the user's machine. | **Yes** | drummy fetches an MPL binary from its upstream and drives it in a separate process. No copyleft code enters the repo, the tarball or drummy's process, and there is no AGPL dependency at all. | Cleaner than D-7, because it is a separate process. |
| **D.** Bundle or vendor the binary or a wrapper into the repo or the tarball | Copies of everything ship from us. | **No** | We would be distributing MPL-2.0 executables (a source offer is required, §3.2), LGPL-3.0+ Cursory data, GPL-3.0 uBO if bundled, Apple and Microsoft fonts that the project says it does not distribute, GeoLite2 data under its EULA and CC BY-SA, and AGPL `ua-parser-js`. The zip is 1.3 GB per platform, and GitHub rejects files over 100 MiB [7]. | Breaks D-7 and the settled constraint. |

**What option C loses without a wrapper.** The browser reads its spoofed identity from environment variables. The launchers write a JSON blob into `CAMOU_CONFIG_1`, `CAMOU_CONFIG_2` and so on, split into chunks of 32,767 characters (2,047 on Windows). They put Firefox preferences into `CAMOU_PREFS_1..N`. On Linux they also set `FONTCONFIG_FILE` to a font config built from the bundled `fontconfig/<os>/fonts.conf` [12]. With no `CAMOU_CONFIG`, the browser's `MaskConfig` falls back to an empty config, so nothing is spoofed [10].

On top of that, C loses:
- the per-launch device identity, drawn from fpgen's real-world model;
- the matching fonts, voices and WebGL values;
- uBO;
- GeoIP-based timezone and locale.

We measured the difference [M]:
- **Raw `firefox.launch({ executablePath })`** reported the user agent `Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Camoufox/156.0.1-beta.36`, with a 1366×768 screen. `navigator.webdriver` was `false`.
- **The official wrapper** reported `… Gecko/20100101 Firefox/156.0`.
- **`camoufox-js`** reported a Windows Firefox 152 user agent with a 3840×1080 screen.

So option C needs drummy to set at least a user agent, or to write its own `CAMOU_CONFIG`. The keys are listed in `browser/settings/properties.json` [1]. Writing an environment variable for a separate MPL program has no licence effect.

**Engineering note.**
- If the fingerprint matters, choose B with `camoufox@0.5.8`. It costs 1.3 GB to download, about 2.8 GB on disk, and Node 22.15.
- If size matters more, choose B with `camoufox-js@0.13.0`. It is a 313 MB download on Apple Silicon. But it runs Firefox 152, and it refuses any build at beta.32 or later until Apify updates it.
- C has the fewest dependencies, but it announces "Camoufox" in its user agent unless drummy supplies its own config.

## Runtime download

### Commands

| | Official `camoufox` 0.5.8 [12] | `camoufox-js` 0.13.0 [16] |
|---|---|---|
| Install the browser | `npx camoufox fetch [version]`. It installs the build this package release is paired with. Pass e.g. `official/135.0-beta.25` for another build. | `npx camoufox-js fetch`. It installs the paired build. No flags. |
| Other subcommands | `sync`, `set [specifier]` (also `--release`, `--geoip`), `list [installed\|all]` (`--path`), `remove [version]` (`--select`, `-y`), `active`, `path`, `version`, `test [url]`, `server`. `gui` exists in the Python package only. | `remove` (deletes the whole install directory and the GeoLite file), `path`, `version`, `test [url]`, `server` |
| Environment variables | `GITHUB_TOKEN`, `XDG_CACHE_HOME` (Linux), `CAMOUFOX_FPGEN_DATA`, `CAMOUFOX_EXECUTABLE_PATH`. There is **no** variable to move the install directory [M]. | `CAMOUFOX_INSTALL_DIR` (moves the install directory), `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` (skips the download at launch), `GITHUB_TOKEN`, `XDG_CACHE_HOME` |
| What `fetch` downloads | 1. `sync`: one GitHub REST call per repo in `repos.yml` (three repos: Official, CoryKing, JWriter20). 2. The browser zip, after checking its sha256 against the digest GitHub's API reports. 3. GeoIP AIO, a 52.5 MB zip that becomes about 115 MiB on disk. 4. The uBO `.xpi` from addons.mozilla.org, 4.65 MB, unpacked to `addons/UBO`. 5. The fpgen model, a 1.56 MB zip that becomes about 204 MiB on disk [12][13][26][M]. | 1. One REST call, `releases/tags/v152.0.4-beta.30`. 2. The browser zip, with its sha256 checked. 3. `GeoLite2-City.mmdb` (50.7 MB) from `P3TERX/GeoLite.mmdb`, which is one more REST call. 4. uBO from addons.mozilla.org, unpacked into the browser folder [16][M]. |
| Download at first launch | Yes. `Camoufox()` waits on `ensureCamoufoxInstalled()`, which downloads the paired build if it is missing. We found no switch to turn this off [12]. | Yes, unless `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` is set [16]. |

**Release asset address.** Each asset is at `https://github.com/daijro/camoufox/releases/download/v<version>-<build>/camoufox-<version>-<build>-<os>.<arch>.zip`. Here `os` is `mac`, `lin` or `win`, and `arch` is `arm64`, `x86_64` or `i686`. The pattern string is `{name}-{version}-{build}-{os}.{arch}.zip` [13][3]. Each release also has a `manifest.json` with the source commit. The official launcher reads an `interface` number from it [3][12].

### Sizes per platform

Download sizes come from the GitHub releases API [3][4]. Unpacked sizes are the sum of the uncompressed sizes in each zip's central directory, which we read with HTTP range requests [6]. On disk on Linux, the unpacked browser was 2.4 GiB for beta.36 and 1.3 GiB for beta.30 [M].

| Build | Platform | Zip (bytes) | Unpacked | Paired with |
|---|---|---|---|---|
| 156.0.1-beta.36 (stable, 2026-10-06) | macOS arm64 | 1,289,762,241 (1.29 GB) | 2.51 GB | `camoufox` 0.5.8 |
| | macOS x86_64 | 1,297,187,860 (1.30 GB) | 2.53 GB | |
| | Linux x86_64 | 1,294,875,941 (1.29 GB) | 2.52 GB | |
| | Linux arm64 | 1,284,863,246 (1.28 GB) | 2.49 GB | |
| 152.0.4-beta.30 (stable, 2026-09-01) | macOS arm64 | 312,665,777 (0.31 GB) | 0.67 GB | `camoufox-js` 0.13.0 |
| | macOS x86_64 | 319,886,717 (0.32 GB) | 0.69 GB | |
| | Linux x86_64 | 663,467,670 (0.66 GB) | 1.28 GB | |
| | Linux arm64 | 653,870,625 (0.65 GB) | 1.25 GB | |

The 156 line is about four times bigger on macOS. Since the font bundle of 2026-09-24, every package carries the font groups for Linux, macOS and Windows. That is 1,513 font files and 2.16 GB in the macOS arm64 build [7][6]. Apple Silicon (`mac.arm64`) builds exist for both lines and for the 158 prerelease [3][5].

### Download time (estimate)

This is file size divided by line speed. It ignores protocol overhead and the speed of GitHub's CDN, so real downloads will be slower.

| Zip | 50 Mbps | 100 Mbps | 300 Mbps |
|---|---|---|---|
| 1.29 GB (any 156.0.1-beta.36 build) | about 3 min 26 s | about 1 min 43 s | about 34 s |
| 0.31 GB (152.0.4-beta.30, macOS arm64) | about 50 s | about 25 s | about 8 s |
| 0.66 GB (152.0.4-beta.30, Linux x86_64) | about 1 min 46 s | about 53 s | about 18 s |

**Unzip time and memory [M].** Both wrappers first save the zip to the OS temp folder, check its sha256, and then unpack it with `adm-zip`. That library reads the whole archive into memory. Two `fetch` runs on our Linux server, which has a fast datacenter link, took:

| Wrapper | Zip | Wall time (download + unzip + extras) | Peak memory |
|---|---|---|---|
| `camoufox-js` | 663 MB | 56 s | 1.2 GB |
| `camoufox` | 1.29 GB | 92 s | 1.76 GB |

At peak you need about zip size plus unpacked size of free disk: roughly 3.8 GB for the 156 line. A Mac on home broadband will take longer (**unverified**).

### Where it lands and what is on disk

Both wrappers pick the same directory [12][16]:
- **macOS:** `~/Library/Caches/camoufox`.
- **Linux:** `$XDG_CACHE_HOME/camoufox`, or `~/.cache/camoufox` when it is unset.
  - The official package accepts any non-blank `XDG_CACHE_HOME`.
  - `camoufox-js` accepts only an absolute one.
- **Windows:** the two differ slightly (`%LOCALAPPDATA%` versus `~/AppData/Local`).

This was the layout after we ran both `fetch` commands into one cache [M]:

```
camoufox/
  .0.5_FLAG                       # marks the shared multi-version layout
  config.json                     # {"active_version": "browsers/official/156.0.1-beta.36-72637885"}
  repo_cache.json                 # official: result of `sync`
  browsers/official/
    152.0.4-beta.30-5720d45b/     # camoufox-js build; folder suffix = first 8 hex of the zip's sha256
      version.json                # {"version":"152.0.4","build":"beta.30","prerelease":false,"sha256":"…","created_at":"…"}
      camoufox-bin, libxul.so, fonts/, fontconfig/, addons/UBO/ …
    156.0.1-beta.36-72637885/     # official build; version.json also has "interface":1
  addons/UBO/                     # official: shared uBO copy
  fpgen/                          # official: device model (about 204 MiB)
  geoip/mmdb/…combined.mmdb       # official: GeoIP AIO
  GeoLite2-City.mmdb              # camoufox-js
```

The browser executable is at:
- **macOS:** `browsers/official/<v>-<b>-<sha8>/Camoufox.app/Contents/MacOS/camoufox`. The launchers resolve it as `Contents/Resources/../MacOS/camoufox`, and the zip holds this file [12][16][6].
- **Linux:** `browsers/official/<v>-<b>-<sha8>/camoufox-bin`.

The folder suffix depends on the platform's zip. For beta.36 it is `0ad5663e` on macOS arm64 and `abe133d2` on macOS x86_64. For beta.30 it is `3b43e766` and `f12f90a3` [3][4].

### Pinning, updates and GitHub limits

**Official `camoufox` 0.5.8 [12][13].**
- `browser-pin.json` pins `v156.0.1-beta.36`. Every launch uses that build, unless the user picks another with `camoufox set`. In that case a warning is shown.
- Builds also carry an "interface" number. The package accepts interface 1 only. An incompatible build raises `UnsupportedVersion`.
- A launch makes no GitHub calls when everything is installed.
- A launch does download uBO or the fpgen model if they are missing.
- GeoIP is re-checked when the file is more than 8 days old, but only when the `geoip` option is used.

**`camoufox-js` 0.13.0 [16].**
- It pins `v152.0.4-beta.30`.
- It accepts builds from beta.30 (needed by Playwright 1.61 and later) up to, but not including, beta.32.
- So it cannot run the 156 line ("The Firefox 156 builds (beta.32+) dropped properties this library still generates").

**GitHub rate limit.** Unauthenticated calls to GitHub's REST API are limited to 60 per hour per IP address [34]. A `fetch` uses about 3 calls (official) or 2 calls (`camoufox-js`). Both wrappers send `GITHUB_TOKEN` if it is set.

### macOS notes

The macOS zip has no `Contents/_CodeSignature/` folder [6]. So the app bundle is not signed as a bundle. Its notarization status is **unverified**.

Users who downloaded the release by hand from the releases page hit Gatekeeper, macOS's check on downloaded apps. The fix was to remove the quarantine attribute, a file flag that marks a download as untrusted: `xattr -d com.apple.quarantine Camoufox.app` [31][32]. Quarantine is normally added by the app that did the download. We do not know whether files fetched by Node and unpacked by `adm-zip` get the attribute (**unverified**; we had no Mac to test on).

## Detecting a missing or broken install

**Cheapest check: no wrapper import.** Test that the executable exists, for example with `fs.existsSync`. The folder name is known in advance: `<cache>/browsers/official/<version>-<build>-<sha8>/`, plus `Camoufox.app/Contents/MacOS/camoufox` on macOS or `camoufox-bin` on Linux. `version.json` is written only after a successful unzip, and both wrappers ignore folders without it [12][16]. Check both files.

**Wrapper functions [12][16][M].**
- **Official `camoufox`.** `installedVerStr()` is exported from the package root. It throws `CamoufoxNotInstalled` when the paired build is missing. `launchPath()` lives in `camoufox/dist/pkgman.js`. The package has no `exports` map, so a deep import works. `launchPath()` throws when the binary itself is missing.
  - **Side effect:** before it checks anything, the official resolver deletes the whole cache directory if the directory is not empty and lacks `.0.5_FLAG`. It prints "Cleaning old data...". `camoufoxPath()` and `launchPath()` both reach this code. `installedVerStr()` does not. Do not call the first two on a cache that might hold an old flat `camoufox-js` install.
- **`camoufox-js`.** `camoufoxPath()` and `launchPath()` are in `camoufox-js/dist/pkgman.js`. The package root exports only `Camoufox`, `NewBrowser`, `launchOptions` and `launchServer`. These functions have no deleting side effect.

**Error texts.** We read these from the source and reproduced the starred ones [M]. `<dir>` is the install or version folder.

| Situation | Raised by | Class | Exact message |
|---|---|---|---|
| Paired build not installed\* | `camoufox` 0.5.8 | `CamoufoxNotInstalled` | `official 156.0.1-beta.36, the browser this camoufox release pairs with, is not installed. Please run \`camoufox fetch\` to install.` |
| `version.json` present, binary missing\* | `camoufox` 0.5.8 | `CamoufoxNotInstalled` | `Camoufox is not installed at <dir>. Please run \`camoufox fetch\` to install.` |
| Other builds installed, none supported, no pin | `camoufox` 0.5.8 | `UnsupportedVersion` | `Camoufox executable is outdated.` |
| Build needs a newer package | `camoufox` 0.5.8 | `UnsupportedVersion` | `Camoufox v<ver> needs a newer camoufox package: it uses browser interface <n>, and this package supports 1-1. Upgrade with \`npm install camoufox@latest\`. Or run \`camoufox fetch\` to install a browser this package supports.` |
| Download corrupted | both | `CorruptedDownload` | `Checksum mismatch for Camoufox v<ver>.` followed by the expected and actual sha256, then `The download was corrupted or tampered with. Installation aborted.` (this exact text is from `camoufox`) |
| Nothing installed\* | `camoufox-js` 0.13.0 | `CamoufoxNotInstalled` | `Camoufox v152.0.4-beta.30 is not installed at <cache dir>. Please run \`camoufox fetch\` to install.` The message says `camoufox`, but the command for this package is `camoufox-js`. |
| `version.json` present, binary missing\* | `camoufox-js` 0.13.0 | `CamoufoxNotInstalled` | `Camoufox is not installed at <dir>. Please run \`camoufox fetch\` to install.` |
| Installed build out of range | `camoufox-js` 0.13.0 | `UnsupportedVersion` | `Camoufox v<ver> is not supported by this library (supported range: >=beta.30, <beta.32). Please run \`camoufox fetch\` to install a supported version.` |
| `installedVerStr()` with nothing installed\* | `camoufox-js` 0.13.0 | `FileNotFoundError` | `Version information not found at <cache dir>/version.json. Please run \`camoufox fetch\` to install.` |
| No matching release asset | `camoufox-js` 0.13.0 | `MissingRelease` | `No matching release found for <os> <arch> in the supported range: (>=beta.30, <beta.32). Please update the library.` |
| `executablePath` does not exist\* | Playwright 1.62.1 | error | `browserType.launch: Failed to launch firefox because executable doesn't exist at <path>`. The source string is `Failed to launch ${this._name} because executable doesn't exist at ${executablePath}` [20]. |
| Linux without GTK 3 | the browser, via Playwright | `TargetClosedError` in Python Playwright | `BrowserType.launch: Target page, context or browser has been closed`. The browser log shows `XPCOMGlueLoad error for file <dir>/libmozgtk.so:`, then `libgtk-3.so.0: cannot open shared object file: No such file or directory`, then `Couldn't load XPCOM.`, and the process exits with code 255 [30]. |

Notes on the GTK row:
- The file named in the error is `libmozgtk.so`, not `libxul.so`.
- It still happens in 2026 with a v150 build, even headless [33].
- On Debian the fix is to install `libgtk-3-0`, `libx11-xcb1` and `libasound2` [30].
- On macOS, the known launch failure is the Gatekeeper dialog above. Its exact text is **unverified**, because the issue shows only a screenshot [31].

**Shared-cache hazard.** Both wrappers, and the Python package, default to the same directory on macOS and Linux.
- `camoufox-js` up to 0.12.1 used a flat layout. It kept `version.json` at the cache root with the keys `{version, release}`, and its `fetch` deleted and replaced the whole cache directory [17].
- The official and Python packages (0.5 and later) delete a non-empty cache that lacks `.0.5_FLAG` [12].
- The two layouts therefore wiped each other. An old `camoufox-js` reading a new cache failed with the `Version information not found …` error above.

`camoufox-js` 0.13.0 fixed this. It uses the shared `browsers/` layout, writes `.0.5_FLAG`, and reads both `build` and `release` [16]. We checked it: after `camoufox-js` 0.13.0 and `camoufox` 0.5.8 both ran `fetch` into one cache, each one found and launched its own paired build [M].

If drummy uses `camoufox-js`, require 0.13.0 or later, or set `CAMOUFOX_INSTALL_DIR` to a folder drummy owns. The official package has no such setting, so it always shares the user's Camoufox cache.

## Search-engine probe

**Short answer:** 15 of 15 searches got real results. There were no CAPTCHAs, no "unusual traffic" pages and no consent pages. This ran from **a datacenter IP**, which is the worst case. Search engines trust datacenter IPs least. drummy normally runs on a home connection, which they trust more.

### How the probe ran

- **When:** 2026-10-25, 16:10 to 16:18 UTC.
- **Browser:** Camoufox 152.0.4-beta.30 (Linux x86_64, released 2026-09-01), launched through camoufox-js 0.11.5, an older release than 0.13.0 (playwright-core 1.62.1). This is the same browser build that `camoufox-js` 0.13.0 pairs with. Headless. camoufox-js picked a random fingerprint. It said it was Firefox 152 on macOS.
- **Proxy:** none.
- **Pace:** one search at a time. A fresh browser for every search, so no cookies carried over. A random 20 to 30 second gap between searches. Engines in order: Google ×5, then Bing ×5, then DuckDuckGo's HTML version ×5.
- **Queries:** `<title> <artist> drum tab` for five well-known songs.
- **Per page:** load until `domcontentloaded`, wait 3.5 seconds, then save the HTML and a screenshot and run the checks below.

### Results

| Engine | Searches | Got results | CAPTCHA | "Unusual traffic" | Consent page | Results per page | Time per search (launch + load) |
|---|---|---|---|---|---|---|---|
| Google (`www.google.com/search`) | 5 | 5 | 0 | 0 | 0 | 7–8 | 5.5–8.3 s |
| Bing (`www.bing.com/search`) | 5 | 5 | 0 | 0 | 0 | 10 | 5.8–8.0 s |
| DuckDuckGo HTML (`html.duckduckgo.com/html/`) | 5 | 5 | 0 | n/a | n/a | 10 | 5.6 s |

Every page had real drum-tab and drum-sheet-music sites in its top results. DuckDuckGo's top six results were the same sites, in nearly the same order, as Bing's for every song.

Each search, in order:

| # | Engine | Song | Time (UTC) | HTTP | Outcome | Result links |
|---|---|---|---|---|---|---|
| 1 | Google | Back in Black | 16:10:53 | 200 | results | 7 |
| 2 | Google | Billie Jean | 16:11:22 | 200 | results | 8 |
| 3 | Google | Smells Like Teen Spirit | 16:11:56 | (none)¹ | results | 7 |
| 4 | Google | Brick House | 16:12:31 | 200 | results | 8 |
| 5 | Google | Seven Nation Army | 16:13:07 | 200 | results | 8 |
| 6 | Bing | Back in Black | 16:13:35 | 200 | results | 10 |
| 7 | Bing | Billie Jean | 16:14:08 | 200 | results | 10 |
| 8 | Bing | Smells Like Teen Spirit | 16:14:42 | 200 | results | 10 |
| 9 | Bing | Brick House | 16:15:19 | 200 | results | 10 |
| 10 | Bing | Seven Nation Army | 16:15:48 | 200 | results | 10 |
| 11 | DuckDuckGo HTML | Back in Black | 16:16:19 | 200 | results | 10 |
| 12 | DuckDuckGo HTML | Billie Jean | 16:16:48 | 200 | results | 10 |
| 13 | DuckDuckGo HTML | Smells Like Teen Spirit | 16:17:20 | 200 | results | 10 |
| 14 | DuckDuckGo HTML | Brick House | 16:17:47 | 200 | results | 10 |
| 15 | DuckDuckGo HTML | Seven Nation Army | 16:18:19 | 200 | results | 10 |

¹ Playwright's `page.goto()` returned no response object for this one, but the page was a normal results page. Do not rely on the HTTP status alone.

Two extra checks ran after the probe:

- **One more Google search** (a sixth song), to test following a result link. It got results too. See "Result links" below.
- **A control with plain `curl`**, one request per engine, 20 seconds apart, same datacenter IP. This shows what a client *without* a real browser gets:
  - Google: HTTP 200, title `Google Search`, no results. The page is a JavaScript-required wall. Its `<noscript>` text says "Please click here if you are not redirected within a few seconds." and links to `/httpservice/retry/enablejs?sei=…`. It also says "If you're having trouble accessing Google Search, please click here".
  - Bing: HTTP 200 with 10 normal results.
  - DuckDuckGo HTML: **HTTP 202** and a CAPTCHA (details in the table below).

  So a real browser matters for Google (it needs JavaScript) and for DuckDuckGo (it challenged the plain client right away). Bing let even `curl` through.

### What this does and does not show

- **It does not give a block rate.** 0 blocks in 5 tries is too small a sample. The true block rate at this pace could still be as high as about 45% per engine (the exact 95% upper bound for 0 out of 5). What it does show: from the worst kind of IP, a few spaced-out searches were not blocked on sight.
- **Consent pages could not be tested.** Google and Bing show cookie-consent pages and banners mostly to visitors in the EU, UK and EEA. This IP did not get one. The consent signals below come from known page markers, not from this run.
- **Pace matters.** The planned 25-song resilience test will run more searches, closer together. It should log every block it sees (engine, time, which signal fired), so we learn the real rate on a home connection.

### Detection signals

Check in this order: blocked first, then consent, then results. **If a page has zero result links and no clear "no results" message, treat it as blocked and move to the next engine.** That fallback catches block pages whose markup we have not seen yet.

| Engine | Case | Seen here? | Signals |
|---|---|---|---|
| Google | Results | Yes (6/6) | URL path `/search`. Title is `<query> - Google Search`. `#search a h3` matches 7–8 links. |
| Google | CAPTCHA / "unusual traffic" | No | Text "Our systems have detected unusual traffic from your computer network" (Google's help page quotes this message [36]). A reCAPTCHA widget (`iframe[src*="recaptcha"]`). Commonly reported but **not verified here**: a redirect to `www.google.com/sorry/index?continue=…`, HTTP 429, a form with id `captcha-form`. |
| Google | JavaScript-required wall | Yes (with `curl` only) | Title is just `Google Search`. No `#search a h3`. A link to `/httpservice/retry/enablejs`. Text "If you're having trouble accessing Google Search". Camoufox runs JavaScript, so it never hit this. |
| Google | Consent page | No | Not verified here: a redirect to host `consent.google.com`, page text "Before you continue to Google", buttons "Accept all" / "Reject all". |
| Bing | Results | Yes (5/5, and `curl`) | URL path `/search`. Title is `<query> - Search`. `#b_results > li.b_algo` matches 10 items. |
| Bing | CAPTCHA | No | Not verified here. Use the fallback rule: zero `li.b_algo` and no "There are no results for" text means blocked. |
| Bing | Cookie banner | No | Not verified here: a banner with id `bnp_container` on top of the results. It does not block the results, so parse the page anyway. |
| DuckDuckGo HTML | Results | Yes (5/5) | URL `html.duckduckgo.com/html/`. Title is `<query> at DuckDuckGo`. `.result__a` matches 10 links (skip any `.result--ad`). |
| DuckDuckGo HTML | CAPTCHA | Yes (with `curl` only) | **HTTP 202** instead of 200. Text "Unfortunately, bots use DuckDuckGo too." and "Please complete the following challenge to confirm this search was made by a human." and "Select all squares containing a duck". Elements with classes starting `anomaly-modal__` (for example `anomaly-modal__puzzle`). |
| DuckDuckGo HTML | Consent page | No | None seen. Use the fallback rule if one ever appears. |

Page text and class names change without warning. Keep the checks in one small module with fixture tests, and lean on the fallback rule.

### Result links

None of the three engines put the plain destination URL in the result link. The tool has to unwrap it:

| Engine | Result link looks like | How to get the real URL |
|---|---|---|
| Google | `/goto?url=<opaque token>` | We could not decode the token. Other links on the same page used the older `/url?…&url=<URL>` form (in a `data-sb` attribute), so handle that form and plain `href`s too. The `<cite>` text shows only the site and a breadcrumb (for example `https://example.com › Artist`). Request the `/goto` link **without following redirects**. Google answers **302** with the real URL in the `Location` header. Tested once and it worked. That is one small extra request to Google per result you want. |
| Bing | `https://www.bing.com/ck/a?…&u=a1<base64url>…` | Take the `u` parameter, drop the leading `a1`, and base64url-decode the rest. Worked for all 50 links checked. |
| DuckDuckGo HTML | `//duckduckgo.com/l/?uddg=<percent-encoded URL>&rut=…` | Percent-decode the `uddg` parameter. Worked for all 50 links checked. |

These formats are what the engines served on 2026-10-25. They are engine details, not tab-site details, so they don't conflict with the "find tabs by their shape" rule. Still, test them with fixtures and expect them to change.

## Sources

1. `daijro/camoufox` README at commit `8589f98` (2026-10-25): https://github.com/daijro/camoufox/blob/8589f980fda690af63181350e7904bd621bf088e/README.md
2. `daijro/camoufox` LICENSE (MPL-2.0) at `8589f98`: https://github.com/daijro/camoufox/blob/8589f980fda690af63181350e7904bd621bf088e/LICENSE
3. GitHub Releases API for `daijro/camoufox`, plus release `v156.0.1-beta.36` and its `manifest.json`: https://api.github.com/repos/daijro/camoufox/releases and https://github.com/daijro/camoufox/releases/tag/v156.0.1-beta.36
4. Release `v152.0.4-beta.30`: https://github.com/daijro/camoufox/releases/tag/v152.0.4-beta.30
5. Release `v158.0-beta.40` (prerelease): https://github.com/daijro/camoufox/releases/tag/v158.0-beta.40
6. Zip central directories of the assets in [3], [4] and [5], read with HTTP range requests (file lists, uncompressed sizes, absence of `_CodeSignature` and `addons/`).
7. `browser/bundle/FONTS-README.txt` at `8589f98`: https://github.com/daijro/camoufox/blob/8589f980fda690af63181350e7904bd621bf088e/browser/bundle/FONTS-README.txt
8. `browser/scripts/fetch-ubo.py` at `8589f98`. Future builds will bundle uBO; the releases above do not contain it yet: https://github.com/daijro/camoufox/blob/8589f980fda690af63181350e7904bd621bf088e/browser/scripts/fetch-ubo.py
9. Cursory NOTICE at `8589f98`, also present at tag `v156.0.1-beta.36` (commit `7a4ac0d`): https://github.com/daijro/camoufox/blob/8589f980fda690af63181350e7904bd621bf088e/browser/additions/juggler/input/cursory/NOTICE
10. `MaskConfig.hpp` at `8589f98`: https://github.com/daijro/camoufox/blob/8589f980fda690af63181350e7904bd621bf088e/browser/additions/camoucfg/MaskConfig.hpp
11. npm registry, `camoufox` (versions, dates, maintainer). The provenance for 0.5.8 points to tag `v0.5.8`, commit `ac2ce31`: https://registry.npmjs.org/camoufox and https://registry.npmjs.org/-/npm/v1/attestations/camoufox@0.5.8
12. `camoufox` TypeScript source at tag `v0.5.8` (`typescript/package.json`, `README.md`, `src/paths.ts`, `pkgman.ts`, `multiversion.ts`, `browser-pin.ts`, `addons.ts`, `exceptions.ts`, `__main__.ts`, `__version__.ts`, `utils.ts`): https://github.com/daijro/camoufox/tree/ac2ce31c0e875b4009e97bc86927b5ed5dbf49d7/typescript
13. `camoufox` 0.5.8 tarball (`LICENSE`, `THIRD_PARTY_NOTICES.md`, `dist/fpgen/NOTICE`, `dist/fpgen/pin.js`, `dist/data-files/repos.yml`, `dist/data-files/browser-pin.json`): https://registry.npmjs.org/camoufox/-/camoufox-0.5.8.tgz
14. PyPI `camoufox` and `python/pyproject.toml` at `8589f98`: https://pypi.org/pypi/camoufox/json and https://github.com/daijro/camoufox/blob/8589f980fda690af63181350e7904bd621bf088e/python/pyproject.toml
15. npm registry, `camoufox-js`. The provenance for 0.13.0 points to commit `95df87c`: https://registry.npmjs.org/camoufox-js
16. `apify/camoufox-js` at commit `95df87c` (`LICENSE.md`, `package.json`, `README.md`, `src/__main__.ts`, `pkgman.ts`, `multiversion.ts`, `browser-pin.ts`, `__version__.ts`, `addons.ts`, `data-files/browser-pin.json`): https://github.com/apify/camoufox-js/tree/95df87c595aa471a8a263e787e58a7d15c4b89a8
17. `camoufox-js` 0.12.1 tarball, `dist/pkgman.js`: https://registry.npmjs.org/camoufox-js/-/camoufox-js-0.12.1.tgz
18. `ua-parser-js` registry metadata, plus `LICENSE.md` and the README licence table in 2.0.10: https://registry.npmjs.org/ua-parser-js
19. `better-sqlite3` 13.0.3 tarball (`package.json`, `prebuilds/`): https://registry.npmjs.org/better-sqlite3
20. `playwright-core` and `playwright` registry metadata, and `lib/coreBundle.js` in 1.62.1: https://registry.npmjs.org/playwright-core
21. Mozilla Public License 2.0: https://www.mozilla.org/en-US/MPL/2.0/
22. GNU Affero General Public License v3: https://www.gnu.org/licenses/agpl-3.0.html
23. GNU General Public License v3: https://www.gnu.org/licenses/gpl-3.0.html
24. Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
25. uBlock Origin repo licence, and the addons.mozilla.org API record (1.75.0, GPL-3.0-only): https://github.com/gorhill/uBlock and https://addons.mozilla.org/api/v5/addons/addon/ublock-origin/
26. `daijro/geoip-all-in-one` README, licence and release 2026.10.21: https://github.com/daijro/geoip-all-in-one
27. `P3TERX/GeoLite.mmdb` README, "License" section: https://github.com/P3TERX/GeoLite.mmdb
28. `scrapfly/fingerprint-generator` (Apache-2.0): https://github.com/scrapfly/fingerprint-generator
29. Firefox `LICENSE`: https://github.com/mozilla-firefox/firefox/blob/main/LICENSE
30. Issue daijro/camoufox#44, "Debian needs libgtk-3-0, libx11-xcb1 & libasound2": https://github.com/daijro/camoufox/issues/44
31. Issue daijro/camoufox#480, "Mac Can't install this app": https://github.com/daijro/camoufox/issues/480
32. Issue daijro/camoufox#464 (manual downgrade and `xattr` fix): https://github.com/daijro/camoufox/issues/464
33. Issue elyxlz/vesta#1245 (the libgtk error with Camoufox v150, 2026): https://github.com/elyxlz/vesta/issues/1245
34. GitHub REST API rate limits, which give 60 requests per hour unauthenticated. An unauthenticated `GET /rate_limit` also returned `limit: 60`: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
35. Node.js release schedule (v20 end of life 2026-04-30; v22 end of life 2027-04-30): https://github.com/nodejs/Release/blob/main/schedule.json
36. Google Search Help, "Unusual traffic from your computer network": https://support.google.com/websearch/answer/86640
