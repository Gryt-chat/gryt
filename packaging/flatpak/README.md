# Flatpak

Every Release Client run builds two Flatpak bundles and attaches them to the release:
`Gryt-Chat-<version>-linux-x86_64-slim.flatpak` from the slim `.deb`, and
`Gryt-Chat-<version>-linux-x86_64.flatpak` from the full one. Slim leaves the built-in
server out and is what the site offers Linux by default; full has it. They install side
by side, under different app IDs, rather than one replacing the other.
`.github/workflows/release-flatpak.yml` does the work, and
`.github/scripts/build-flatpak.sh` is the part you can run yourself.

Nothing here goes to Flathub. GRYT-969 has the history, and why a person has to
be the one who submits it if that ever happens.

## What's here

| File | What it is |
|---|---|
| `chat.gryt.Gryt.yml` | The slim manifest. Unpacks the slim `.deb` the script copies in. |
| `chat.gryt.Gryt.metainfo.xml` | AppStream metadata for slim. The script fills in the release. |
| `chat.gryt.Gryt.desktop` | Slim's desktop entry, including the `gryt://` handler. |
| `chat.gryt.Gryt.sh` | Slim's launcher. Electron needs `zypak-wrapper` inside a Flatpak. |
| `chat.gryt.Gryt.Full.yml` | The full manifest, app ID `chat.gryt.Gryt.Full`. Otherwise identical. |
| `chat.gryt.Gryt.Full.metainfo.xml` | AppStream metadata for full. |
| `chat.gryt.Gryt.Full.desktop` | Full's desktop entry. |
| `chat.gryt.Gryt.Full.sh` | Full's launcher. |

Both manifests delete `resources/package-type` from the app. That file is how
electron-updater decides to install a new `.deb`, and without it the updater has
nothing it can install, so the app never tries to replace itself.

Full's `finish-args` are the same as slim's. The embedded server
(`packages/client/electron/embeddedServerManager.ts`) only binds ports and spawns
child processes inside the sandbox, and only writes under the app's own data
directory, which is private and writable without a grant. `--share=network`,
already there for joining calls, opens every port in both directions, so hosting
from inside the sandbox doesn't need anything slim doesn't already have.

## Installing and updating

```bash
flatpak install --user Gryt-Chat-1.11.42-linux-x86_64-slim.flatpak
flatpak install --user Gryt-Chat-1.11.42-linux-x86_64.flatpak
```

Both can be installed at once. The bundle names Flathub as the place to get the
runtime, so this works on a machine that has never added Flathub. A bundle has no
remote to update from, so to update you download the next one and run the same
command.

## Building it yourself

On a machine with `flatpak` and `flatpak-builder`:

```bash
.github/scripts/build-flatpak.sh Gryt-Chat-1.11.42-linux-amd64-slim.deb 1.11.42 out-slim.flatpak chat.gryt.Gryt
.github/scripts/build-flatpak.sh Gryt-Chat-1.11.42-linux-amd64.deb 1.11.42 out-full.flatpak chat.gryt.Gryt.Full
```

Or dispatch **Build the Flatpak bundle** with a tag and leave `upload` off. Both
bundles come out as workflow artifacts and the release isn't touched.
