# Readbook

A small, private, mobile-first book reader. A password-only entrance opens your personal library. Create and edit books, upload covers, write or paste chapters, and optionally import TXT/Markdown files, set chapter order, and read with responsive pages, swipe gestures, keyboard navigation, and saved progress. Appearance settings include eight themes, six local font stacks, accent and custom colours, spacing, alignment, text weight, margins, and page animations. Built-in Kokoro reads complete sentence groups with natural voices and speed controls; device voices are available as a fallback.

## Run locally

Requires Node.js 24 or newer. Run `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci` to install the CPU speech runtime. There is no frontend build step.

```sh
cp .env.example .env
# Edit APP_PASSWORD, then:
node --env-file=.env server.js
```

Open http://localhost:3000. For plain HTTP local development, use `COOKIE_SECURE=false`. In production HTTPS, leave it unset or `true`.

```sh
npm test
```

## Deploy on Coolify at readbook.moondzie.me

1. Add a new application from `willowisslay/readbook`, branch `main`.
2. Choose **Dockerfile** as the build pack, `/Dockerfile` as the Dockerfile location, and **3000** as the application port. The Dockerfile installs the CPU speech runtime automatically. No extra build command is needed.
3. Set the domain to `https://readbook.moondzie.me`. Point the DNS A/AAAA record to your Coolify server and enable HTTPS in Coolify.
4. Add runtime environment variable **APP_PASSWORD**, with a unique password at least 12 characters long. Do not set it as a build argument. Set **COOKIE_SECURE=true** and **DATA_DIR=/data**.
5. Add persistent storage: a named volume mounted at **/data**. The container runs as Node's non-root user (UID 1000); a bind-mounted directory must be writable by that UID. Do not use multiple replicas: this app uses one SQLite database.
6. Deploy. The public page contains only the password field and unlock button. Health checks use `/health`.

Alternatively, `docker compose up -d --build` uses the included Compose configuration. Set APP_PASSWORD in a local `.env` first. Use Coolify or another HTTPS reverse proxy in front of it.

## Data, privacy, and backup

All books, image covers, chapters, progress, settings, and sessions are stored in `/data/readbook.sqlite`. Back up the persistent volume regularly. For a consistent simple backup, stop the app, copy the entire `/data` directory (including any SQLite WAL files), and restart it. Restoring that directory restores the library. Never commit a database or `.env` file.

Sessions use random, HttpOnly, SameSite=Strict, secure cookies with a 30-day expiry. Login is rate-limited by the direct connection IP (behind Coolify this can be shared across clients). Passwords are checked on the server; no book data is embedded in the unauthenticated page. Changing APP_PASSWORD requires restarting; existing sessions remain valid until expiry. To revoke all sessions, stop the application and run `DELETE FROM sessions` against the SQLite database, then restart it.

Covers accept PNG, JPEG, or WebP up to 4 MB. Chapters accept UTF-8 TXT or MD up to 2 MB. Markdown supports headings, emphasis, lists, quotes, links, tables, task lists, and fenced/inline code. Preview and reading share one sanitized renderer. Raw HTML is escaped; remote images are rendered as descriptions without fetching their targets. Set unique positive chapter order numbers for a precise sequence. Progress and settings are shared between devices for this single-user library. Reading requires a connection; this is not an offline ebook sync service.

The optional device-voice fallback uses the Web Speech API and the voices available on the device. Listen mode automatically advances through pages and chapters with device voices too. Voice availability, network use by system voices, background playback, and offline behavior depend on the browser/OS. Test on your actual phone; mobile browsers can suspend speech when the screen locks.

## Built-in Kokoro voices

Kokoro-82M is bundled through `kokoro-js` and runs directly inside the Readbook container in an isolated Node child process. No separate service, account, API key, GPU, or additional public endpoint is required. This uses the same model family as [Parrot](https://github.com/rishiskhare/parrot), rather than embedding its desktop application.

Tap Listen in the reader. On first use, Readbook downloads the quantized model from Hugging Face into `/data/models` (under your configured DATA_DIR). The download can take a few minutes; keep the persistent volume so it survives redeploys. Later synthesis runs locally on your Coolify server. Outbound HTTPS access to Hugging Face and its model CDN is needed for the initial download. The speech process stays loaded after first use; allocate sufficient CPU and RAM, with 2 GB RAM as a starting point and more if your server needs it. Hardware affects generation latency. Set `TTS_ENABLED=false` to disable built-in synthesis.

Appearance settings let you select American or British voices, speed, or device voices. The built-in engine supports English voices in this version. Audio controls provide pause, resume, and seeking; some mobile browsers require tapping Play after generation. Listen mode continues across chapters until the book ends.

Speech is generated in stable sentence groups, independent of page layout. Ordinary sentences crossing a visual page are synthesized once, without resetting the voice at the page edge. Playback tracks visual page changes within a group using approximate text/time proportions; device voices use word boundaries where supported. When you start partway through a sentence, Listen rewinds to its speech group so you hear a complete thought. Exceptionally long sentences are split at clauses or words for the model context; an extremely small viewport can also require splitting to respect the five-page limit.

The app prepares up to five visual pages ahead, including in-flight audio. It builds a 15-second future-audio reserve before starting, or starts when the remaining bounded queue is complete for a short book/window. **Play now** bypasses that initial reserve once the first group is ready. The status shows buffered seconds rather than treating every sentence group as a full page. If generation falls behind, playback waits rather than skipping text. Faster playback consumes the reserve faster; a CPU slower than real-time generation cannot sustain indefinite uninterrupted playback.

Stop, manual navigation, voice or typography changes, and screen resizing discard the playback queue. An in-flight inference cooperatively cancels at its next boundary while preserving the loaded model. Changing the layout requires tapping Listen again; completed sentence audio can be reused from cache. Finished audio is released from browser memory, and prefetch never moves or saves the visible reading position. Inputs are limited to 6,000 characters and generation to five minutes. Input exceeding the model token context is detected and split rather than silently truncated.

Audio uses 16-bit PCM WAV, halving transfer/cache size compared with the previous float32 output without adding a codec dependency. Generated audio is cached privately in `/data/audio-cache`, keyed by text, voice, speed, and pipeline version. The default limit is **256 MB**, with old entries evicted automatically. `TTS_CACHE_MB=0` disables this cache; the directory can be deleted while the app is stopped without affecting books. Cache files contain your book text as speech and belong in the same private volume as the library. `TTS_THREADS` can override CPU inference threads (1–32); the default uses at most two threads and respects the container CPU quota. No extra environment variables are required. Text is processed on your server, never sent to a speech provider. Third-party licenses remain in installed dependencies.

## Continuous-listening checks

`npm test` covers library endpoints, playback ordering, the five-page prefetch cap, waiting for slow generation, cancellation, warm-process recovery, sentence preservation, bounded audio caching, and end-of-book behavior. For browser regression tests, run `npx playwright install chromium` then `npm run test:browser`. Those tests use deterministic audio to exercise mobile pagination, chapter transitions, progress, queue invalidation, and device voices. Kokoro speech generation can still be slower than playback on a small CPU; prefetch reduces gaps but cannot guarantee gapless playback. Mobile browser autoplay and screen-lock restrictions still apply.

A local two-CPU benchmark of roughly 21 seconds of narration measured about 17 seconds of fresh generation; raw CPU throughput changed only slightly. A separate real HTTP check generated a 6.35-second sample in 5.6 seconds and retrieved the cached result in 9 ms. These are development-machine measurements, not a performance guarantee for your Coolify server. The buffer, stable sentence cache, warm process, and smaller files primarily reduce startup/repeated work and avoid audible page-edge interruptions.

## Narration formatting and screen timeout

Narration strips Markdown formatting markers, escape backslashes, list/heading prefixes, code fences, dividers, and link destinations. It keeps the words, link labels, normal punctuation, and paragraph pauses. This applies to TXT and MD chapters and both Kokoro and device voices. The stored chapter and its display are unchanged. Cleaned text is also enforced by the speech endpoint, so old cached audio containing raw formatting is bypassed automatically when the cleaned text differs. There is no need to clear the cache.

While Listen mode is active, including buffering and audio pauses, the app requests a **Screen Wake Lock**. Stop, end of book, playback errors, and leaving the reader release it. Returning to a visible tab reacquires it if Listen is still active. This requires HTTPS and a browser/device that supports and permits the API; battery-saving policies can refuse or revoke it. The app shows a brief message if it cannot keep the screen awake. It cannot override a manually locked screen or guarantee background playback. Use Stop when you want the screen to resume its normal timeout.

## Reader controls and background sounds

The reader has one appearance entry and one narration player. Reading settings are grouped into keyboard-accessible **Reading**, **Voice**, and **Sounds** tabs. Icons are official Lucide SVGs, bundled locally with their ISC license in `public/icons.js`; no icon/font CDN is used. To regenerate the selected icons after development changes, run `npm run icons` (requires dev dependencies). The generated icon module and favicon are committed, so Coolify needs no extra frontend build step.

**Background sounds** opens the sound mixer. Choose **Rain**, **Forest**, or **Water**, or choose **None**. These are synthesized nature soundscapes: filtered rain, wind with occasional bird-like chirps, and a gently modulated stream. They are generated on the device using Web Audio, not downloaded field recordings. Scene changes fade, and background volume is separate from narration volume. Preferences are saved in the existing database. Starting Listen also starts the selected background sound; the background can play on its own. Pausing or stopping narration leaves ambience playing. Pause background, choose None, or leave the book to stop it. Audio starts only after a user interaction.

For Kokoro playback, ready audio is decoded during prefetch. The next clip is scheduled against the current clip's end on the audio clock, with small edge fades and conservative trimming of excessive near-silence. Spoken words do not crossfade or overlap, and normal breathing room is retained. Pause and seeking cancel/reschedule queued voice sources while leaving the background bus alone. The existing five-visual-page horizon, startup reserve, and private audio cache remain unchanged. This improves ready-clip handoffs; a CPU that cannot generate the next clip in time can still cause a buffering gap.

Modern browsers with Web Audio get scheduled narration and ambience. The app retains native-media narration as a fallback, and device voices continue to use the browser's speech engine. Device-voice volume changes may apply at the next speech group, depending on the browser. Screen-lock/background-playback restrictions still apply; keep the reader visible for the most reliable mobile playback. No new environment variables or external services are required.

## Compact reader and text-first chapters

The reader footer is a single compact dock. Listen starts narration; the same control pauses/resumes it, or offers Play now while the initial reserve is building. The adjacent audio button opens detailed Voice controls, including Stop and seeking, or Sounds when narration is inactive. Tap the page count or Chapters to jump to a page/chapter. There are no permanent playback sliders beneath the text.

On phones, settings open as bottom sheets and chapter editing uses the full screen. Sheet open/close, tab changes, button presses, and page changes use short transitions. System reduced-motion preferences disable these animations; page motion can also be set to Fade, Slide, or None.

Appearance includes Paper, White, Sepia, Sage, Rose, Slate, Night, and Black themes; six device-local font stacks; five accent presets; optional custom page/text colours; line, paragraph, and letter spacing; alignment, weight, side margins, reading width, and hyphenation. Spacing/layout and custom colours are expandable. Reset appearance restores reading defaults while keeping voice and background-sound settings. Fonts depend on the device's installed fonts and have local fallbacks.

New chapters default to Markdown. A title, positive order, and nonempty text are sufficient—no upload is required. Paste or type in Write, use the formatting toolbar (or Cmd/Ctrl+B, I, K), and switch to Preview before saving. Cmd/Ctrl+Enter saves. Import file optionally fills the same editable text area from TXT or MD. Existing plain-text chapters remain plain text unless you change the format or use formatting tools. Markdown is parsed with Marked and sanitized with DOMPurify; both are bundled locally with their licenses. Run `npm run vendor` after changing their dev dependencies to refresh committed vendor assets. Coolify still needs no frontend build or new environment variables.

## Install, offline reading, and site-wide themes

Readbook is an installable PWA. Open it over **HTTPS**, unlock the library, then use **App settings → Install Readbook**. On iPhone/iPad use Safari's **Share → Add to Home Screen**; on Android use the browser's install action. The installed app uses standalone mode so the regular address bar is hidden. Where available, **App settings → Enter fullscreen** hides additional browser controls. Fullscreen support and OS status/navigation bars depend on the device; iOS does not offer the standard fullscreen API for this app.

The selected theme and custom page/text/accent colours apply to the library, book details, editors, password screen, and settings as well as the reader. The theme colour meta tag changes with the page background, allowing supported browsers and installed Android apps to match their surrounding chrome. iOS uses its supported translucent status-bar treatment and safe-area background. System UI may still impose its own colours. A local appearance snapshot restores the theme before the server preferences load.

Open a book and tap its **download icon → Download book** to save the cover, metadata, and every chapter on that device. Repeat the download to refresh an edited book; changes online do not silently replace an offline copy. Downloads are device/browser-specific; download inside the installed app if its storage is separate from your browser. The library shows download icons and, when offline, only saved books. Books can be read, paginated, searched, and resumed without a connection. Appearance and progress save locally and sync when you reconnect, next open online, or use **Sync progress**. Offline changes take precedence when uploaded; subsequent online changes use the server's current preferences. Creating/editing/deleting library content still needs a connection.

For offline Kokoro listening, choose a chapter in **Offline reading → Chapter narration**, select your voice and speed in settings first, and **Download chapter audio**. Narration is generated serially on your existing server and saved on your device; no model download to the phone is needed. Keep the app open and online. A chapter can take several minutes to prepare. Cancelled/failed downloads retain finished parts; **Resume audio download** reuses them with the same voice and speed. The **Use saved voice & speed** action selects the recorded settings. Each chapter currently retains one voice/speed combination. Changing these requires another audio download. Saved narration is matched by text, voice, and speed; ordinary page/font changes reuse the recording. Refreshing a book removes audio for changed/deleted chapters. Offline playback continues across downloaded chapters and stops with a helpful message if the next recording is missing. Background sounds are synthesized locally and work offline. Device voices may also work offline if the OS has an appropriate voice installed, but this varies.

**App settings → On this device** shows downloads, storage use, and narration size. Remove an individual book/audio download from its Offline reading sheet, or remove all downloads from App settings. Persistent storage is requested after downloads, but browsers can refuse and phones can reclaim storage. Downloads are not backups. Books/audio are stored in IndexedDB on the device without an additional offline password/encryption layer, as an explicitly unlocked offline copy. **Lock library removes all private downloads and pending sync data from that device** and requires the password again, even if locked without internet. Sync progress before locking if you want to keep offline changes on the server. A password change cannot remotely erase copies already downloaded elsewhere. An online session rejection blocks local offline access until unlocked online again.

Only public application assets enter the versioned service-worker cache; private API responses, passwords, and session tokens never enter it. A new app version waits until **App settings → Update & restart** (or all old app windows close) before activating. Downloads survive app updates. The Docker build and `npm start` regenerate the shell version automatically. After frontend changes in development run **`npm run service-worker`** before testing offline/update behavior; the generated worker is committed. No additional Coolify environment variables, services, or volumes are required.
