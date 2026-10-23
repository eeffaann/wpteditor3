# WPT Editor 3

React + TypeScript + Vite workspace for rebuilding the TravelMapping waypoint editor.

## Features

The app currently includes:

- `.wpt` parsing for `label URL` lines using OpenStreetMap URLs with `lat` and `lon` query params
- live source-to-map synchronization, including typed and pasted edits
- folder loading, multiple active/background routes, route renaming and removal
- waypoint insertion, dragging, deletion, reordering, alternate labels, and station/geometry conversion
- shared-station coordinate editing across loaded routes
- route reversal, clear, and undo (up to 20 edits, including multi-route changes)
- Leaflet rendering and TravelMapping-specific validation with original source-line references
- exact-source clipboard export, `Save to Tab`, downloads, and direct file saving in supported browsers
- modified/unmodified indicators, separate local-save status, reload warnings, and local workspace recovery

The external map-link feature and the full TravelMapping validation suite are not implemented.

## Editing and shared names

Source edits immediately update the route table and map. **Add Route** creates another
route from the current source; **Replace Route** reloads the current route from that source.
Map and table edits preserve malformed lines, blank lines, and unchanged waypoint formatting
instead of discarding source that could not be parsed. Coordinates on changed waypoint lines
are written with six decimal places. Invalid/out-of-range coordinates remain in the source
with a diagnostic and are not sent to the map.

**Names at shared coordinates** has two modes:

- **Shared names** (default): visible waypoints at coordinates matching to six decimal places
  share their primary name. Imports and enabling this mode use the first loaded name;
  editing a name in the source or popup propagates it to connected routes. Enabling the mode
  on an existing workspace requires confirmation. Changes are undoable and affected routes
  are marked unsaved.
- **Independent names**: each route keeps its own primary and alternate labels. This mode
  does not undo names already harmonized; use Undo to revert the mode change and its edits.

Alternate labels remain route-specific in either mode. Hidden geometry-point names are
not harmonized. Shared-station dragging still updates matching coordinates in both modes.

## Saving and recovery

Route labels show **unmodified** or **modified** relative to the text originally pasted or
loaded, independently of whether a local file exists. A first paste into an empty source
also establishes this baseline before adding the route. Reverting edits (including Undo)
restores the unmodified label when the source matches again. Saving does not reset this
original-text comparison: a route can be both modified and saved locally.

The smaller local-save status separately shows whether the current source has been saved.
An unmodified pasted route can still be unsaved locally, and the existing leave-page warning
continues to protect it. Recovery preserves both the original-text and local-save baselines.

**Add Folder** uses the File System Access API when available, retaining handles for direct
save-back. Other browsers use a folder file input and can export with **Download** or
**Save to Tab**. Renaming a loaded route changes its in-memory filename, not the original
disk file; its next save uses Save As. Save failures and clipboard failures are shown in the
editor. A route is marked saved only after the write and close succeed; edits made while
saving remain unsaved. Downloads, copying, and Save to Tab do not mark source files saved.

The workspace source, naming mode, and saved-file baselines are stored in this browser's
local storage after a short debounce and when leaving the page. Recovery is local to this
site/browser profile; it is not a disk backup or cross-device synchronization. Storage errors
are reported explicitly. Recovery does not restore undo history or file permissions/handles,
so saving a recovered route requires choosing its destination again. Reload/close warnings
depend on browser support. Do not rely on recovery instead of saving files.

## Scripts

- `npm run dev` starts the Vite development server
- `npm run build` runs TypeScript build validation and creates a production bundle
- `npm run lint` runs ESLint across the workspace
- `npm test` runs parser/document, reducer, recovery, file-write, and UI regression tests
- `npm run preview` serves the production bundle locally

## Local Development

```bash
npm install
npm run dev
```

Use Node.js 22.12 or later. Pull requests run lint, tests, and a production build.
The deployment workflow runs the same checks before publishing.

## Deployment

The app is hosted on GitHub Pages at https://eeffaann.github.io/wpteditor3/.
Vite's base path is `/wpteditor3/` so built assets resolve under the repository URL.

In the repository's **Settings > Pages**, set **Build and deployment > Source**
to **GitHub Actions**. The `Deploy to GitHub Pages` workflow builds and deploys
the `dist` directory on pushes to `master`, or when run manually from the
Actions tab. No Azure resources or deployment secrets are needed.

The first deployment happens after the workflow is committed and pushed to
`master`. The previous Azure Static Web Apps workflow has been removed; any
existing Azure resource and its repository deployment secret can be deleted
separately if no longer needed.

## Code organization

- `src/wpt`: parsing, lossless source reconciliation, export, validation, and shared geometry
- `src/editor`: reducer, route table, file I/O, dirty tracking, and workspace recovery
- `src/map`: Leaflet rendering/interactions and waypoint popup editing
