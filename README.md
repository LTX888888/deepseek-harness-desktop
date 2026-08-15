# DeepSeek Harness Desktop

A native desktop application wrapping the DeepSeek Harness Web GUI.

## Quick Start

```bash
# From this directory
npm start          # Launch the desktop app
npm run smoke      # Headless smoke test (captures screenshot to smoke-screenshot.png)
npm run dist       # Build Windows installer + portable exe (output in release/)
```

## How It Works

1. **Locates the harness** — prefers the bundled runtime shipped inside the packaged app (`resources/harness-runtime`, the npm-published `@deepseek-ai/dsh`); falls back to a checkout at `C:\Users\lrl07\deepseek-harness` (or `DSH_ROOT`) in dev mode.
2. **Starts the server** — runs `dsh web` (via Electron's bundled Node runtime, `ELECTRON_RUN_AS_NODE=1`) on port 3080, or reuses an existing harness already on port 3080.
3. **Opens a native window** — Electron BrowserWindow loads `http://127.0.0.1:3080`.
4. **Lifecycle** — Closing the window stops the spawned server (if we started it).

## Language switching (菜单语言切换)

The native menu has a **语言 / Language** menu with 中文 / English. Selecting one writes
`locale.preference` into `$DSH_HOME/settings.yaml`; the harness settings-file provider
hot-publishes the edit (chokidar watch), so the GUI language flips **live, without a reload**.
Menu labels (文件/File, 编辑/Edit, …) follow the active locale.

## Incremental updates (增量更新)

The framework (Electron binary + bundled harness runtime) is fixed after install;
app code ships unpacked (`resources/app.asar.unpacked/src/`). After editing `src/`,
push just the code change to the installed app — no framework re-download:

```bash
npm run patch        # copy src/*.cjs over the installed app, then restart it
```

Requires a one-time install of a build with `asarUnpack` enabled (0.1.2+).
For fresh installs or framework upgrades, use `npm run dist` as usual.

## Configuration

| Environment Variable | Purpose |
|---------------------|---------|
| `DSH_ROOT` | Override harness checkout location (must contain `apps/cli/src/bin.ts`) |
| `DSH_DESKTOP_SMOKE=1` | Enable smoke test mode (capture screenshot & exit) |
| `DSH_DESKTOP_SMOKE_OUTPUT` | Custom screenshot output path |

## Requirements

- **Packaged exe**: Windows 10/11, nothing else (self-contained).
- **Dev mode** (`npm start`): Node.js 18+, and either the bundled runtime or a harness checkout.

## Building Installers

```bash
npm run prepare-runtime   # (re)install the bundled harness runtime from npm
npm run dist              # bump patch version + build installer/portable/uninstaller
npm run dist:minor        # bump minor version + build
npm run dist:major        # bump major version + build
```

`dist` auto-increments the patch version (0.1.0 → 0.1.1 → …) so every build
iteration produces distinctly-named artifacts and keeps previous versions in
`release/`. Produces (version-tagged):

- `DeepSeek-Harness-Setup-<version>.exe` — NSIS installer (one-click overwrite)
- `DeepSeek-Harness-Portable-<version>.exe` — Portable standalone exe
- `DeepSeek-Harness-Uninstall-<version>.exe` — Standalone uninstaller

The packaged app is **self-contained**: it bundles the harness engine (the
published `@deepseek-ai/dsh` npm package) and runs it with Electron's own Node
runtime, so it does not require the harness checkout or a system Node install.

## Architecture

```
src/
├── main.cjs             # Electron main process (window, lifecycle)
├── harness.cjs          # Harness server management (spawn, port, readiness)
├── preload.cjs          # Secure renderer bridge
├── settings.cjs         # settings.yaml read/write (locale preference)
scripts/
├── gen-icon.cjs         # Renders the app icon from the harness favicon
├── prepare-runtime.cjs  # Installs the bundled harness runtime from npm
├── bump-version.cjs     # Increments package.json version (patch/minor/major)
├── post-dist.cjs        # Refreshes the standalone uninstaller in release/
assets/
├── icon.png             # App icon (DeepSeek mark in brand blue)
harness-runtime/         # Bundled harness (npm @deepseek-ai/dsh), packed into the app
build/                   # electron-builder resources
release/                 # Build output
```

## Troubleshooting

**"Cannot locate DeepSeek Harness checkout"**
- Set `DSH_ROOT` to your harness root directory
- Or ensure the checkout exists at `C:\Users\lrl07\deepseek-harness`

**Port 3080 already in use**
- The app detects if a harness is already running on 3080 and reuses it
- If another process holds 3080, it tries 3081, 3082, ...

**Window shows blank/error**
- Check console output for server startup logs
- Ensure `pnpm run build` has been run in the harness repo (builds `apps/web/dist`)