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

## Next Implementation Targets

1. Draggable marker editing with undoable coordinate updates
2. Waypoint add/delete and popup actions on the map
3. Alternate label support and hidden waypoint workflows
4. Richer TravelMapping-specific validation rules
5. Azure Static Web App deployment polish
