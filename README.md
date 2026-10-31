# WPT Editor 3

Browser-based TravelMapping `.wpt` editor with a live map, waypoint table, and source
validation. Built with React, TypeScript, Vite, and Leaflet.

[Open the editor](https://eeffaann.github.io/wpteditor3/).

## Reviewing routes with a human or agent

1. Agree on the route files, intended changes, and who will write each file. The editor
   is a local workspace, not a real-time collaboration or file-locking service.
2. Choose **Independent names** before loading files for a review that must not
   automatically change names. The default **Shared names** mode can change imported
   routes to match names already loaded at the same coordinates.
3. Use **Add** or **Add Folder**, then select a route in Loaded Routes. List
   selection fits the map; clicking a background route line selects it without moving
   the map. Review source, table, and validation together.
4. Make small edits. Source edits apply immediately; map and table edits update the
   source. Identify findings by filename, waypoint label, and source line, include the
   relevant source text, and describe the proposed change. Use **Undo** to back out edits.
5. Before handing files back, review every affected route, save or download the intended
   files, and inspect their diffs. A clean validation panel does not establish that a
   route is correct or passes the full TravelMapping validation suite.

Before an agent changes a file on disk, save browser edits and hand off the file.
After the agent finishes, use **Refresh route** to read it into the editor rather than
saving the stale browser copy over the agent's work. Disk edits are not watched
automatically. Refresh asks before replacing unsaved browser edits; direct saving is
not a merge operation. Coordinate writes rather than editing the same file concurrently.
For automated browser interaction, prefer accessible control names over icon glyphs
or CSS selectors.

## Route controls

| Action | Effect |
| --- | --- |
| **New** | Creates a blank route; other loaded routes remain intact. |
| **Add** / **Add Folder** | Adds `.wpt` files, retaining handles for direct save-back where supported. |
| **Load pasted route** | Adds a nonempty source draft to Loaded Routes; only appears before a route is active. |
| **Reverse** / **Clear** | Edits the active route; both can be undone. |
| **Open text in new tab** / **Download** | Exports the current source without marking it saved locally. |
| **New session** | Clears the workspace and recovery after confirmation; cannot be undone. Keeps the naming preference and never deletes disk files. |

New/add actions ask before discarding a source draft. Undo retains up to 20 edits.
Finish file saves or refreshes before starting a new session.

## Editing behavior

The parser reads `label URL` lines with OpenStreetMap `lat` and `lon` query parameters.
Map/table edits preserve malformed lines, blank lines, and unchanged waypoint formatting.
Changed coordinates use six decimal places. Invalid coordinates remain in the source
with diagnostics but are not rendered on the map.

**Names at shared coordinates** controls primary names at coordinates matching to
six decimal places:

- **Shared names**: matches visible station names to the first loaded route;
  name edits can propagate across routes. Enabling it with routes loaded requires
  confirmation. Check all affected routes before saving.
- **Independent names** (default): keeps route names separate. Switching modes does not undo
  earlier harmonization; use Undo to revert it.

Recovered workspaces retain their saved naming mode.

Alternate labels stay route-specific; hidden geometry names are not harmonized.
Shared-station dragging moves matching coordinates in either mode. Select a point
before moving the mouse at least 10 pixels while holding the left button to drag it.
Clicks, smaller movements, and mouse release alone cannot start a drag.
Station popups hide the alternate-label editor until **Edit alt labels** is pressed.
Concurrent route names are editable directly; **Copy From** uses that route's name on
the current point, and **Copy To** sends the current name to that route. Name edits
follow the shared/independent naming mode without changing alternate labels or coordinates.
**Naming details** in the editor expands the naming explanation.

Drag table rows or use their move controls to reorder waypoints. New geometry nodes
and converted default `WP` stations receive random six-digit `+X` labels unique on the route;
converting a custom station keeps its name with a leading `+`.

The external map-link feature and the full TravelMapping validation suite are not implemented.

## Saving, refresh, and recovery

| Status | Meaning |
| --- | --- |
| **Unmodified / modified** | Source matches / differs from the original pasted or loaded text. Saving does not reset this comparison. |
| **Saved locally / changes not saved locally** | Source and filename match / differ from the last successful file read or direct save. |
| **Not saved locally** | No local-save baseline exists, as with a new or pasted route. |

A first paste into an empty draft establishes its original-text baseline. A route can
be both modified and saved locally. Downloads, clipboard copies, and text tabs do not
confirm a disk write or update local-save status.

Direct file saving requires browser support for the File System Access API. Fallback
file/folder inputs can load routes but cannot save back directly; use Download instead.
Renaming changes only the in-memory filename; the next direct save uses Save As.
Save and storage errors are reported in the editor. Edits made during a save remain unsaved.

**Refresh route** rereads the linked file, preserving route identity and selection.
It resets original-text and local-save baselines; Undo restores the previous edits.
In shared-name mode, refresh can also update names in other loaded routes. Edits made
while a refresh is reading cancel that refresh. Renamed routes retain their old link
until saved elsewhere. Pasted, fallback-imported, or recovered routes need to be reopened
with file handles or saved directly before they can refresh.

Recovery uses this browser profile's local storage, not a disk backup or cross-device
sync. It preserves source and save baselines, but not undo history or file handles;
recovered routes must choose a destination before saving again. Reload/close warnings
depend on browser support. Save files before relying on recovery or clearing a session.

## Development

Use Node.js 22.12 or later.

```bash
npm ci
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm test` | Parser/document, reducer, recovery, file I/O, and UI regression tests. |
| `npm run lint` | ESLint. |
| `npm run build` | TypeScript checks and production bundle. |
| `npm run preview` | Serve the production bundle locally. |

Pull requests and deployment run lint, tests, and build.

### Code organization

- `src/wpt`: parsing, lossless source edits, export, validation, shared geometry.
- `src/editor`: reducer, route table, file I/O, dirty tracking, workspace recovery.
- `src/map`: Leaflet rendering, interactions, and waypoint popups.

Keep UI copy focused on actions and consequences. Use code comments for non-obvious
constraints, not narration. Preserve malformed source and the distinction between
original-text and local-save baselines when changing editor behavior.

## Deployment

GitHub Pages serves the app with Vite base path `/wpteditor3/`. Set repository
**Settings > Pages > Build and deployment > Source** to **GitHub Actions**.
The `Deploy to GitHub Pages` workflow publishes `dist` after pushes to `master`
or a manual run from Actions. No deployment secrets are required.
