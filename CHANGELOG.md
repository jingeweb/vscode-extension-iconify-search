# Change Log

## 1.0.0 ~ 1.0.3 (2026-11-06)

- refactor: rewrite extension logic and UI (AI-assisted)
- feat: download icon data from npm automatically and build a local index; `@iconify/json` is no longer required in the workspace, so multi-root workspaces work and the "package not found" error is gone
- feat: add "Icon Name" and "Iconify React" options to "Type of code" (`solar:eye-line-duotone` and `<Icon icon="solar:eye-line-duotone" />`)
- chore: use VS Code codicons for the extension UI icons
- fix: re-running a command now activates the existing Iconify tab instead of showing a "not supported" message
- fix: remove scroll jank in the icon gallery
- chore: require VS Code 1.145 or newer
- docs: update usage instructions

## 0.0.1 ~ 0.0.2 (2024-05-28)

- feat: first release version
