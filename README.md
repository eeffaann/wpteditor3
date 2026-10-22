# WPT Editor 3

React + TypeScript + Vite workspace for rebuilding the TravelMapping waypoint editor.

## Current Slice

The app currently includes:

- `.wpt` parsing for `label URL` lines using OpenStreetMap URLs with `lat` and `lon` query params
- route loading and load-and-pan flows
- route reversal, undo, clear, layout toggle, and line thickness control
- in-use label loading and map highlighting
- Leaflet route rendering with waypoint markers and parser issue reporting
- export preview plus `Save to Tab` behavior

The current implementation intentionally omits the external map-link feature and does not yet include marker dragging, popup editing actions, alternate labels, or the full TravelMapping validation suite.

## Scripts

- `npm run dev` starts the Vite development server
- `npm run build` runs TypeScript build validation and creates a production bundle
- `npm run lint` runs ESLint across the workspace
- `npm run preview` serves the production bundle locally

## Local Development

```bash
npm install
npm run dev
```

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

## Next Implementation Targets

1. Draggable marker editing with undoable coordinate updates
2. Waypoint add/delete and popup actions on the map
3. Alternate label support and hidden waypoint workflows
4. Richer TravelMapping-specific validation rules
