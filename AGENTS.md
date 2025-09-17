# Repository Guidelines

## Project Structure & Module Organization
- `src/` houses the React UI; keep view logic in `components/`, async bridges in `services/`, state in `stores/`, and shared contracts in `protocol/`.
- `src-tauri/` is the Rust shell (`src/` commands, `resources/` bundles, `tauri.conf.json` packaging). Mirror new commands with TypeScript facades under `src/services`.
- `apps/license-api` and `apps/relay-worker` contain Cloudflare Workers backing licenses and relay. Shared DTOs live in `src/protocol`.
- `python-sidecar/` ships the rembg pipeline; update it through `python-sidecar/build_sidecar_macos.sh`. Treat `dist/` as generated.

## Build, Test, and Development Commands
- `npm install` after branch changes to sync Tauri, React, and plugin versions.
- `npm run dev` starts Vite; pair with `npm run tauri dev` for the desktop shell with live reload.
- `npm run build` enforces `tsc` and produces production assets consumed by Tauri packaging.
- `npm run build:sidecar:mac` refreshes the bundled Python environment before release builds.

## Coding Style & Naming Conventions
- Use 2 spaces, semicolons, and double quotes in TypeScript to match existing files; rely on editor format-on-save.
- Components/hooks are `PascalCase`, functions `camelCase`, constants shared with Rust `SCREAMING_SNAKE_CASE`.
- Scope styles with `.module.scss`; global overrides belong in `styles/`.
- Keep logs purposeful (`[File] message`) and delete noisy traces prior to release branches.

## Testing Guidelines
- Automated suites are pending; run `npm run dev` or `npm run tauri dev` to smoke test uploads, workspace bootstrap, relay connectivity, and updater prompts.
- Exercise the Python sidecar by calling `invoke('warmup_python')` before background removal scenarios.
- For new pure logic, add lightweight Vitest specs under `src/__tests__` and declare `vitest` in devDependencies.
- Record manual test notes or edge cases in `docs/TESTING.md` to keep QA expectations aligned with `REQUIREMENTS.md`.

## Commit & Pull Request Guidelines
- Follow the existing conventional format (`feat(scope): detail`, `fix(scope): detail`, `revert(scope): reason`).
- PRs should explain intent, risks, test evidence, and reference requirements or issues.
- Mention configuration touches affecting `src-tauri/resources` or Worker secrets directly in the description.
- Run relevant build commands before review and note outcomes in the PR.

## Security & Configuration Tips
- Commit no secrets; rely on Tauri secure storage and Worker environment bindings.
- Update `src/services/globalSettings` alongside the bundled `global_settings.json` when changing defaults.
- Respect the Auto/Relay/Local routing rules and CORS expectations documented in `REQUIREMENTS.md` whenever touching connectivity code.
