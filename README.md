# Readbook

A small, private, mobile-first book reader. A password-only entrance opens your personal library. Create and edit books, upload covers and TXT/Markdown chapters, set chapter order, and read with responsive pages, swipe gestures, keyboard navigation, and saved progress. Appearance settings include paper, white, sage, and night themes, text size, line spacing, reading width, and serif/sans fonts. Built-in Kokoro reads the visible page with natural voices and speed controls; device voices are available as a fallback.

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

Covers accept PNG, JPEG, or WebP up to 4 MB. Chapters accept UTF-8 TXT or MD up to 2 MB. Markdown supports headings, paragraphs, emphasis, and blockquotes; raw HTML and external resources are not rendered. Set unique positive chapter order numbers for a precise sequence. Progress and settings are shared between devices for this single-user library. Reading requires a connection; this is not an offline ebook sync service.

The optional device-voice fallback uses the Web Speech API and the voices available on the device. It reads the current page and stops when you turn pages. Voice availability, network use by system voices, background playback, and offline behavior depend on the browser/OS. Test on your actual phone; mobile browsers can suspend speech when the screen locks.

## Built-in Kokoro voices

Kokoro-82M is bundled through `kokoro-js` and runs directly inside the Readbook container in an isolated Node worker. No separate service, account, API key, GPU, or additional public endpoint is required. This uses the same model family as [Parrot](https://github.com/rishiskhare/parrot), rather than embedding its desktop application.

Tap Listen in the reader. On first use, Readbook downloads the quantized model from Hugging Face into `/data/models` (under your configured DATA_DIR). The download can take a few minutes; keep the persistent volume so it survives redeploys. Later synthesis runs locally on your Coolify server. Outbound HTTPS access to Hugging Face and its model CDN is needed for the initial download. The worker stays loaded after first use; allocate sufficient CPU and RAM, with 2 GB RAM as a starting point and more if your server needs it. Hardware affects generation latency. Set `TTS_ENABLED=false` to disable built-in synthesis.

Appearance settings let you select American or British voices, speed, or device voices. The built-in engine supports English voices in this version. Audio controls provide pause, resume, and seeking; some mobile browsers require tapping Play after generation. Readbook generates the current page and stops when it ends or you turn a page. It processes one request at a time, limits input to 6,000 characters and generation to five minutes, and splits long text into short chunks to prevent model truncation. Your book text is processed on your server, never sent to a speech provider. Third-party model and runtime licenses are retained in the installed dependencies.
