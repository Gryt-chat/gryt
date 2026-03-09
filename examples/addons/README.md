# Gryt Addons

Addons extend the Gryt client with custom themes and plugins. Drop addon folders into the addons directory and they'll appear in **Settings > Addons**.

## Addon types

| Type | Purpose | Manifest fields |
|------|---------|-----------------|
| **Theme** | Override CSS variables and styles | `styles` (array of CSS files) |
| **Plugin** | Inject JavaScript with full DOM access | `main` (JS entry point) |

## Directory structure

```
addons/
├── my-theme/
│   ├── addon.json
│   ├── banner.png       (optional, ~800x400)
│   └── theme.css
├── my-plugin/
│   ├── addon.json
│   ├── banner.png       (optional)
│   └── plugin.js
└── addons.json          (web/Docker only, generated)
```

## Manifest (`addon.json`)

### Theme

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "type": "theme",
  "description": "A custom color scheme.",
  "author": "Your Name",
  "banner": "banner.png",
  "styles": ["theme.css"]
}
```

### Plugin

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "type": "plugin",
  "description": "Does something cool.",
  "author": "Your Name",
  "banner": "banner.png",
  "main": "plugin.js"
}
```

## Installation

### Desktop (Electron)

1. Open **Settings > Addons** and click **Open Addons Folder**.
2. Copy your addon folder there.
3. The addon appears automatically (the folder is watched for changes).
4. Toggle it on in Settings.

### Web / Docker

1. Place addon folders in a directory on the host.
2. Run `bash generate-index.sh` inside that directory to create `addons.json`.
3. Mount the directory into the client container:
   ```yaml
   volumes:
     - ./addons:/addons:ro
   ```
4. Addons appear in **Settings > Addons** after a page reload.

## Overridable CSS variables

Themes can override these variables on `.radix-themes`, `.dark .radix-themes`, or `.light .radix-themes`:

| Variable | Description |
|----------|-------------|
| `--color-background` | Main app background |
| `--color-panel-solid` | Panel/card background |
| `--color-panel-translucent` | Semi-transparent panels |
| `--color-surface` | Inputs and surfaces |
| `--color-overlay` | Modal backdrop |
| `--gryt-titlebar-bg` | Titlebar background (Electron) |
| `--default-font-family` | Primary font |
| `--code-font-family` | Monospace font |
| `--chat-font-size` | Chat message font size |
| `--gray-1` ... `--gray-12` | Radix gray scale |
| `--accent-1` ... `--accent-12` | Radix accent scale |

## Stable layout selectors

Use these `data-gryt` attributes to target specific areas:

| Selector | Element |
|----------|---------|
| `[data-gryt="sidebar"]` | Sidebar |
| `[data-gryt="server-view"]` | Main content area |
| `[data-gryt="chat-view"]` | Chat panel |
| `[data-gryt="voice-view"]` | Voice panel |
| `[data-gryt="titlebar"]` | Titlebar |
| `[data-gryt="settings"]` | Settings dialog |

## Plugin API

Plugins have access to `window.gryt`:

```js
// App version
console.log(window.gryt.version);

// Current theme
console.log(window.gryt.theme); // { appearance: "dark", accentColor: "violet" }

// Listen for theme changes
const unsub = window.gryt.on("themeChange", (theme) => {
  console.log("Theme changed:", theme.appearance, theme.accentColor);
});
// Call unsub() to stop listening
```
