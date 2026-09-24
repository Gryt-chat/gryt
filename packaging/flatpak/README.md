# Flatpak

Every Release Client run builds a Flatpak bundle from the release's slim `.deb`
and attaches it to the release as `Gryt-Chat-<version>-linux-x86_64-slim.flatpak`.
Slim leaves the built-in server out, and it's what the site offers Linux by default.
`.github/workflows/release-flatpak.yml` does the work, and
`.github/scripts/build-flatpak.sh` is the part you can run yourself.

Nothing here goes to Flathub. GRYT-969 has the history, and why a person has to
be the one who submits it if that ever happens.

## What's here

| File | What it is |
|---|---|
| `chat.gryt.Gryt.yml` | The manifest. Unpacks the `.deb` the script copies in. |
| `chat.gryt.Gryt.metainfo.xml` | AppStream metadata. The script fills in the release. |
| `chat.gryt.Gryt.desktop` | Desktop entry, including the `gryt://` handler. |
| `chat.gryt.Gryt.sh` | Launcher. Electron needs `zypak-wrapper` inside a Flatpak. |

The manifest deletes `resources/package-type` from the app. That file is how
electron-updater decides to install a new `.deb`, and without it the updater has
nothing it can install, so the app never tries to replace itself.

## Installing and updating

```bash
flatpak install --user Gryt-Chat-1.11.42-linux-x86_64-slim.flatpak
```

The bundle names Flathub as the place to get the runtime, so this works on a
machine that has never added Flathub. A bundle has no remote to update from, so
to update you download the next one and run the same command.

## Building it yourself

On a machine with `flatpak` and `flatpak-builder`:

```bash
.github/scripts/build-flatpak.sh Gryt-Chat-1.11.42-linux-amd64-slim.deb 1.11.42 out.flatpak
```

Or dispatch **Build the Flatpak bundle** with a tag and leave `upload` off. The
bundle comes out as a workflow artifact and the release isn't touched.
