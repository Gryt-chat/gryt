# Flatpak packaging

**Carlo submits this to Flathub. Nothing here opens a pull request against
`flathub/flathub`.** Two attempts from `sivert-io` were closed in March, one of
them as "AI slop", and Gryt's standing there is spent one attempt at a time.
GRYT-969 has the history.

## What is here

| File | What it is |
|---|---|
| `chat.gryt.Gryt.yml` | The manifest. Builds from the release `.deb`. |
| `chat.gryt.Gryt.metainfo.xml` | AppStream metadata: the store page. |
| `chat.gryt.Gryt.desktop` | Desktop entry, including the `gryt://` handler. |
| `chat.gryt.Gryt.sh` | Launcher. Electron needs `zypak-wrapper` under a runtime. |

`url`, `sha256` and the `<release>` are placeholders, rewritten per release the
same way `packaging/aur/PKGBUILD` and `packaging/homebrew/gryt-chat.rb` are.

## Building it

On a machine with flatpak:

```bash
flatpak install --user flathub org.flatpak.Builder
flatpak run org.flatpak.Builder --force-clean --user \
  --install-deps-from=flathub --repo=repo --install builddir chat.gryt.Gryt.yml
```

Then the three checks Flathub CI runs:

```bash
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest chat.gryt.Gryt.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder builddir builddir
flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo
```

## Still open before submission

- **The app ID is Carlo's to settle.** `chat.gryt.Gryt` is used throughout
  because gryt.chat is the domain, but their `io.github.*` form is also allowed.
  Changing it means renaming all four files.
- **Screenshots** point at the video posters gryt.chat already serves. They are
  real and reachable, but they are `.webp` posters rather than pictures taken for
  a store page.
- **The sandbox has not been exercised.** Voice, screen sharing through the
  portal and the `gryt://` handler all need a desktop session to test, and the
  build was done over SSH on a box with no session running.
