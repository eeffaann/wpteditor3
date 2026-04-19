import type { EditorAction, EditorSnapshot, EditorState, LoadedRoute } from './editorTypes'
import { parseInUseLabels } from '../wpt/parseWpt'
import { buildOsmUrl, exportWpt } from '../wpt/exportWpt'
import { validateRoute } from '../wpt/validateRoute'

function toMercatorPoint(lat: number, lon: number) {
  return {
    x: lon / 360 + 0.5,
    y: 0.5 * Math.log(Math.tan(Math.PI / 4 - (Math.PI / 360) * lat)) / Math.PI + 0.5,
  }
}

function squareDistance(x1: number, y1: number, x2: number, y2: number) {
  return (x1 - x2) ** 2 + (y1 - y2) ** 2
}

function nearestInsertionIndex(waypoints: EditorState['waypoints'], lat: number, lon: number) {
  if (waypoints.length <= 1) {
    return waypoints.length
  }

  const target = toMercatorPoint(lat, lon)
  const firstPoint = toMercatorPoint(waypoints[0].lat, waypoints[0].lon)
  let bestIndex = 0
  let bestDistance = squareDistance(target.x, target.y, firstPoint.x, firstPoint.y)

  const lastWaypoint = waypoints.at(-1)
  if (lastWaypoint) {
    const lastPoint = toMercatorPoint(lastWaypoint.lat, lastWaypoint.lon)
    const lastDistance = squareDistance(target.x, target.y, lastPoint.x, lastPoint.y)
    if (lastDistance < bestDistance) {
      bestDistance = lastDistance
      bestIndex = waypoints.length
    }
  }

  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const start = toMercatorPoint(waypoints[index].lat, waypoints[index].lon)
    const end = toMercatorPoint(waypoints[index + 1].lat, waypoints[index + 1].lon)
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const segmentLengthSquared = deltaX ** 2 + deltaY ** 2

    if (segmentLengthSquared === 0) {
      continue
    }

    const projection = Math.max(
      0,
      Math.min(1, ((target.x - start.x) * deltaX + (target.y - start.y) * deltaY) / segmentLengthSquared),
    )

    const projectedX = start.x + projection * deltaX
    const projectedY = start.y + projection * deltaY
    const distance = squareDistance(target.x, target.y, projectedX, projectedY)

    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index + 1
    }
  }

  return bestIndex
}

function nextGeneratedLabel(existingLabels: string[], hidden: boolean) {
  const existing = new Set(existingLabels)

  if (hidden) {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = `+X${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`
      if (!existing.has(candidate)) {
        return candidate
      }
    }

    for (let index = 0; index < 1_000_000; index += 1) {
      const candidate = `+X${String(index).padStart(6, '0')}`
      if (!existing.has(candidate)) {
        return candidate
      }
    }
  }

  for (let index = 1; index < 1_000_000; index += 1) {
    const candidate = `WP${index}`
    if (!existing.has(candidate)) {
      return candidate
    }
  }

  return hidden ? '+X999999' : 'WP999999'
}

function normalizeWaypointLabel(rawLabel: string, hidden: boolean, existingLabels: string[]) {
  const compactLabel = rawLabel.trim().replace(/\s+/g, '_')
  const strippedLabel = compactLabel.replace(/^\+/, '')

  if (hidden) {
    return strippedLabel ? `+${strippedLabel}` : nextGeneratedLabel(existingLabels, true)
  }

  if (!strippedLabel || /^X\d{6}$/i.test(strippedLabel)) {
    return nextGeneratedLabel(existingLabels, false)
  }

  return strippedLabel
}

function buildWaypointId(waypoints: EditorState['waypoints'], label: string, lat: number, lon: number) {
  const baseId = `${label}-${lat.toFixed(6)}-${lon.toFixed(6)}`

  if (!waypoints.some((candidate) => candidate.id === baseId)) {
    return baseId
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidateId = `${baseId}-${index}`
    if (!waypoints.some((candidate) => candidate.id === candidateId)) {
      return candidateId
    }
  }

  return `${baseId}-${Date.now()}`
}

function syncActiveRoute(state: EditorState, nextRoute: Pick<LoadedRoute, 'inputText' | 'waypoints' | 'issues'>) {
  if (!state.activeRouteId) {
    return state
  }

  return {
    ...state,
    loadedRoutes: state.loadedRoutes.map((route) =>
      route.id === state.activeRouteId
        ? {
            ...route,
            inputText: nextRoute.inputText,
            waypoints: nextRoute.waypoints,
            issues: nextRoute.issues,
          }
        : route,
    ),
  }
}


function sameCoordinate(lat1: number, lon1: number, lat2: number, lon2: number) {
  return lat1.toFixed(6) === lat2.toFixed(6) && lon1.toFixed(6) === lon2.toFixed(6)
}

function toCoordinateKey(lat: number, lon: number) {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

function mergeLoadedRoutesByCoordinate(routes: LoadedRoute[]) {
  const canonicalLabelByCoordinate = new Map<string, string>()

  for (const route of routes) {
    for (const waypoint of route.waypoints) {
      if (waypoint.hidden) {
        continue
      }

      const key = toCoordinateKey(waypoint.lat, waypoint.lon)
      if (!canonicalLabelByCoordinate.has(key)) {
        canonicalLabelByCoordinate.set(key, waypoint.label)
      }
    }
  }

  return routes.map((route) => {
    let routeUpdated = false
    const nextWaypoints = route.waypoints.map((waypoint) => {
      if (waypoint.hidden) {
        return waypoint
      }

      const canonicalLabel = canonicalLabelByCoordinate.get(toCoordinateKey(waypoint.lat, waypoint.lon))
      if (!canonicalLabel || canonicalLabel === waypoint.label) {
        return waypoint
      }

      routeUpdated = true
      return {
        ...waypoint,
        label: canonicalLabel,
      }
    })

    if (!routeUpdated) {
      return route
    }

    return {
      ...route,
      waypoints: nextWaypoints,
      issues: validateRoute(nextWaypoints),
      inputText: exportWpt(nextWaypoints),
    }
  })
}

function syncInputText(state: EditorState, waypoints: EditorState['waypoints']) {
  const nextRoute = {
    waypoints,
    issues: validateRoute(waypoints),
    inputText: exportWpt(waypoints),
  }

  const nextState = {
    ...state,
    ...nextRoute,
  }

  return syncActiveRoute(nextState, nextRoute)
}

function cloneSnapshot(state: EditorState): EditorSnapshot {
  return {
    inputText: state.inputText,
    waypoints: state.waypoints,
    issues: state.issues,
    loadedLabelSet: state.loadedLabelSet,
    loadedRoutes: state.loadedRoutes,
    activeRouteId: state.activeRouteId,
  }
}

function withHistory(state: EditorState): EditorState {
  return {
    ...state,
    history: [...state.history.slice(-19), cloneSnapshot(state)],
  }
}

export const initialEditorState: EditorState = {
  inputText: '',
  inUseLabelText: '',
  waypoints: [],
  issues: [],
  loadedLabelSet: [],
  layout: 'wide',
  thicknessStep: 0,
  fitRequest: 0,
  loadedRoutes: [],
  activeRouteId: null,
  history: [],
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'input/set':
      return {
        ...state,
        inputText: action.value,
      }
    case 'labels/input-set':
      return {
        ...state,
        inUseLabelText: action.value,
      }
    case 'route/load': {
      const nextState = withHistory(state)
      const loaded = {
        ...nextState,
        waypoints: action.route.waypoints,
        issues: action.route.issues,
        inputText: state.inputText,
        fitRequest: action.fitToRoute ? state.fitRequest + 1 : state.fitRequest,
      }

      return syncActiveRoute(loaded, {
        waypoints: action.route.waypoints,
        issues: action.route.issues,
        inputText: state.inputText,
      })
    }
    case 'routes/add-route': {
      const nextState = withHistory(state)
      const mergedRoutes = mergeLoadedRoutesByCoordinate([...nextState.loadedRoutes, action.route])
      const activeRoute = mergedRoutes.find((route) => route.id === action.route.id) ?? mergedRoutes.at(-1)

      if (!activeRoute) {
        return state
      }

      return {
        ...nextState,
        loadedRoutes: mergedRoutes,
        activeRouteId: activeRoute.id,
        inputText: activeRoute.inputText,
        waypoints: activeRoute.waypoints,
        issues: activeRoute.issues,
        fitRequest: state.fitRequest + 1,
      }
    }
    case 'routes/replace-active-route': {
      const nextState = withHistory(state)

      if (!nextState.activeRouteId || nextState.loadedRoutes.length === 0) {
        const mergedRoutes = mergeLoadedRoutesByCoordinate([action.route])
        const [activeRoute] = mergedRoutes

        return {
          ...nextState,
          loadedRoutes: mergedRoutes,
          activeRouteId: activeRoute.id,
          inputText: activeRoute.inputText,
          waypoints: activeRoute.waypoints,
          issues: activeRoute.issues,
          fitRequest: state.fitRequest + 1,
        }
      }

      const replacedRoutes = nextState.loadedRoutes.map((route) =>
        route.id === nextState.activeRouteId ? action.route : route,
      )
      const mergedRoutes = mergeLoadedRoutesByCoordinate(replacedRoutes)
      const activeRoute = mergedRoutes.find((route) => route.id === action.route.id)

      if (!activeRoute) {
        return state
      }

      return {
        ...nextState,
        loadedRoutes: mergedRoutes,
        activeRouteId: activeRoute.id,
        inputText: activeRoute.inputText,
        waypoints: activeRoute.waypoints,
        issues: activeRoute.issues,
        fitRequest: state.fitRequest + 1,
      }
    }
    case 'route/insert': {
      const label = nextGeneratedLabel(
        state.waypoints.map((waypoint) => waypoint.label),
        action.hidden,
      )
      const waypoint = {
        id: buildWaypointId(state.waypoints, label, action.lat, action.lon),
        label,
        altLabels: [],
        lat: Number(action.lat.toFixed(6)),
        lon: Number(action.lon.toFixed(6)),
        hidden: action.hidden,
        url: buildOsmUrl(action.lat, action.lon),
      }

      const insertIndex = nearestInsertionIndex(state.waypoints, action.lat, action.lon)
      const waypoints = [
        ...state.waypoints.slice(0, insertIndex),
        waypoint,
        ...state.waypoints.slice(insertIndex),
      ]

      return syncInputText(withHistory(state), waypoints)
    }
    case 'route/rename-waypoint': {
      const waypoint = state.waypoints.find((candidate) => candidate.id === action.waypointId)
      const trimmedLabel = action.nextLabel.trim()

      if (!waypoint || !trimmedLabel) {
        return state
      }

      const previousState = withHistory(state)

      if (!previousState.activeRouteId || previousState.loadedRoutes.length === 0) {
        const otherLabels = previousState.waypoints
          .filter((candidate) => candidate.id !== action.waypointId)
          .map((candidate) => candidate.label)
        const normalizedLabel = normalizeWaypointLabel(trimmedLabel, waypoint.hidden, otherLabels)
        const waypoints = previousState.waypoints.map((candidate) =>
          candidate.id === action.waypointId
            ? {
                ...candidate,
                label: normalizedLabel,
                hidden: normalizedLabel.startsWith('+'),
              }
            : candidate,
        )

        return syncInputText(previousState, waypoints)
      }

      const nextLoadedRoutes = previousState.loadedRoutes.map((route) => {
        const targetIndexes = route.waypoints.reduce<number[]>((indexes, candidate, index) => {
          const isActiveEditedWaypoint = route.id === previousState.activeRouteId && candidate.id === action.waypointId
          const isConnectedInterchange =
            route.id !== previousState.activeRouteId &&
            !candidate.hidden &&
            sameCoordinate(candidate.lat, candidate.lon, waypoint.lat, waypoint.lon)

          if (isActiveEditedWaypoint || isConnectedInterchange) {
            indexes.push(index)
          }

          return indexes
        }, [])

        if (targetIndexes.length === 0) {
          return route
        }

        const otherLabels = route.waypoints
          .filter((_, index) => !targetIndexes.includes(index))
          .map((candidate) => candidate.label)
        const routeHidden = route.waypoints[targetIndexes[0]].hidden
        const routeLabel = normalizeWaypointLabel(trimmedLabel, routeHidden, otherLabels)

        const nextWaypoints = route.waypoints.map((candidate, index) =>
          targetIndexes.includes(index)
            ? {
                ...candidate,
                label: routeLabel,
                hidden: routeLabel.startsWith('+'),
              }
            : candidate,
        )

        return {
          ...route,
          waypoints: nextWaypoints,
          issues: validateRoute(nextWaypoints),
          inputText: exportWpt(nextWaypoints),
        }
      })

      const activeRoute = nextLoadedRoutes.find((route) => route.id === previousState.activeRouteId)
      if (!activeRoute) {
        return previousState
      }

      return {
        ...previousState,
        loadedRoutes: nextLoadedRoutes,
        waypoints: activeRoute.waypoints,
        issues: activeRoute.issues,
        inputText: activeRoute.inputText,
      }
    }
    case 'route/set-alt-labels': {
      if (!state.waypoints.some((candidate) => candidate.id === action.waypointId)) {
        return state
      }

      const nextAltLabels = action.altLabels.map((label) => label.trim()).filter(Boolean)
      const waypoints = state.waypoints.map((candidate) =>
        candidate.id === action.waypointId
          ? {
              ...candidate,
              altLabels: nextAltLabels,
            }
          : candidate,
      )

      return syncInputText(withHistory(state), waypoints)
    }
    case 'route/toggle-waypoint-kind': {
      const waypoint = state.waypoints.find((candidate) => candidate.id === action.waypointId)

      if (!waypoint) {
        return state
      }

      const otherLabels = state.waypoints
        .filter((candidate) => candidate.id !== action.waypointId)
        .map((candidate) => candidate.label)
      const nextHidden = !waypoint.hidden
      const nextLabel = normalizeWaypointLabel(waypoint.label, nextHidden, otherLabels)
      const waypoints = state.waypoints.map((candidate) =>
        candidate.id === action.waypointId
          ? {
              ...candidate,
              label: nextLabel,
              hidden: nextHidden,
            }
          : candidate,
      )

      return syncInputText(withHistory(state), waypoints)
    }
    case 'route/update-waypoint-position': {
      if (!state.waypoints.some((candidate) => candidate.id === action.waypointId)) {
        return state
      }

      const roundedLat = Number(action.lat.toFixed(6))
      const roundedLon = Number(action.lon.toFixed(6))
      const waypoints = state.waypoints.map((candidate) =>
        candidate.id === action.waypointId
          ? {
              ...candidate,
              lat: roundedLat,
              lon: roundedLon,
              url: buildOsmUrl(roundedLat, roundedLon),
            }
          : candidate,
      )

      return syncInputText(withHistory(state), waypoints)
    }
    case 'route/update-shared-station-position': {
      const roundedSourceLat = Number(action.sourceLat.toFixed(6))
      const roundedSourceLon = Number(action.sourceLon.toFixed(6))
      const roundedLat = Number(action.lat.toFixed(6))
      const roundedLon = Number(action.lon.toFixed(6))

      if (sameCoordinate(roundedSourceLat, roundedSourceLon, roundedLat, roundedLon)) {
        return state
      }

      let hasAnyUpdate = false
      const previousState = withHistory(state)
      const nextLoadedRoutes = previousState.loadedRoutes.map((route) => {
        let routeUpdated = false
        const nextWaypoints = route.waypoints.map((waypoint) => {
          if (!sameCoordinate(waypoint.lat, waypoint.lon, roundedSourceLat, roundedSourceLon)) {
            return waypoint
          }

          routeUpdated = true
          return {
            ...waypoint,
            lat: roundedLat,
            lon: roundedLon,
            url: buildOsmUrl(roundedLat, roundedLon),
          }
        })

        if (!routeUpdated) {
          return route
        }

        hasAnyUpdate = true
        return {
          ...route,
          waypoints: nextWaypoints,
          issues: validateRoute(nextWaypoints),
          inputText: exportWpt(nextWaypoints),
        }
      })

      const nextWaypoints = previousState.waypoints.map((waypoint) => {
        if (!sameCoordinate(waypoint.lat, waypoint.lon, roundedSourceLat, roundedSourceLon)) {
          return waypoint
        }

        hasAnyUpdate = true
        return {
          ...waypoint,
          lat: roundedLat,
          lon: roundedLon,
          url: buildOsmUrl(roundedLat, roundedLon),
        }
      })

      if (!hasAnyUpdate) {
        return state
      }

      const activeRoute = nextLoadedRoutes.find((route) => route.id === previousState.activeRouteId)

      return {
        ...previousState,
        loadedRoutes: nextLoadedRoutes,
        waypoints: activeRoute ? activeRoute.waypoints : nextWaypoints,
        issues: activeRoute ? activeRoute.issues : validateRoute(nextWaypoints),
        inputText: activeRoute ? activeRoute.inputText : exportWpt(nextWaypoints),
      }
    }
    case 'route/delete-waypoint': {
      if (!state.waypoints.some((candidate) => candidate.id === action.waypointId)) {
        return state
      }

      const waypoints = state.waypoints.filter((candidate) => candidate.id !== action.waypointId)
      return syncInputText(withHistory(state), waypoints)
    }
    case 'route/move-waypoint': {
      if (
        action.fromIndex < 0 ||
        action.fromIndex >= state.waypoints.length ||
        action.toIndex < 0 ||
        action.toIndex >= state.waypoints.length ||
        action.fromIndex === action.toIndex
      ) {
        return state
      }

      const waypoints = [...state.waypoints]
      const [movedWaypoint] = waypoints.splice(action.fromIndex, 1)
      waypoints.splice(action.toIndex, 0, movedWaypoint)
      return syncInputText(withHistory(state), waypoints)
    }
    case 'route/reuse-background-station': {
      const roundedLat = Number(action.lat.toFixed(6))
      const roundedLon = Number(action.lon.toFixed(6))
      const otherLabels = state.waypoints.map((candidate) => candidate.label)
      const normalizedLabel = normalizeWaypointLabel(action.label, action.hidden, otherLabels)
      const waypoint = {
        id: buildWaypointId(state.waypoints, normalizedLabel, roundedLat, roundedLon),
        label: normalizedLabel,
        altLabels: action.altLabels,
        lat: roundedLat,
        lon: roundedLon,
        hidden: action.hidden,
        url: buildOsmUrl(roundedLat, roundedLon),
      }

      const insertIndex = nearestInsertionIndex(state.waypoints, roundedLat, roundedLon)
      const waypoints = [
        ...state.waypoints.slice(0, insertIndex),
        waypoint,
        ...state.waypoints.slice(insertIndex),
      ]

      return syncInputText(withHistory(state), waypoints)
    }
    case 'route/merge-background-station': {
      const deleteIndex = state.waypoints.findIndex((w) => w.id === action.deleteWaypointId)
      if (deleteIndex === -1) {
        return state
      }

      const roundedLat = Number(action.lat.toFixed(6))
      const roundedLon = Number(action.lon.toFixed(6))
      const otherLabels = state.waypoints
        .filter((w) => w.id !== action.deleteWaypointId)
        .map((w) => w.label)
      const normalizedLabel = normalizeWaypointLabel(action.label, false, otherLabels)
      const waypoint = {
        id: buildWaypointId(state.waypoints, normalizedLabel, roundedLat, roundedLon),
        label: normalizedLabel,
        altLabels: action.altLabels,
        lat: roundedLat,
        lon: roundedLon,
        hidden: false,
        url: buildOsmUrl(roundedLat, roundedLon),
      }

      const waypoints = state.waypoints.filter((w) => w.id !== action.deleteWaypointId)
      waypoints.splice(deleteIndex, 0, waypoint)

      return syncInputText(withHistory(state), waypoints)
    }
    case 'route/reverse': {
      if (state.waypoints.length < 2) {
        return state
      }

      return syncInputText(withHistory(state), [...state.waypoints].reverse())
    }
    case 'route/clear': {
      if (!state.inputText && state.waypoints.length === 0 && state.issues.length === 0) {
        return state
      }

      const nextState = withHistory(state)
      return {
        ...nextState,
        inputText: '',
        waypoints: [],
        issues: [],
      }
    }
    case 'history/undo': {
      const previous = state.history.at(-1)

      if (!previous) {
        return state
      }

      return {
        ...state,
        inputText: previous.inputText,
        waypoints: previous.waypoints,
        issues: previous.issues,
        loadedLabelSet: previous.loadedLabelSet,
        loadedRoutes: previous.loadedRoutes,
        activeRouteId: previous.activeRouteId,
        history: state.history.slice(0, -1),
      }
    }
    case 'routes/load-folder': {
      if (action.routes.length === 0) {
        return state
      }

      const mergedRoutes = mergeLoadedRoutesByCoordinate(action.routes)

      const nextState = withHistory(state)
      const [activeRoute] = mergedRoutes

      return {
        ...nextState,
        loadedRoutes: mergedRoutes,
        activeRouteId: activeRoute.id,
        inputText: activeRoute.inputText,
        waypoints: activeRoute.waypoints,
        issues: activeRoute.issues,
        fitRequest: state.fitRequest + 1,
      }
    }
    case 'routes/add-folder': {
      if (action.routes.length === 0) {
        return state
      }

      const nextState = withHistory(state)
      const mergedRoutes = mergeLoadedRoutesByCoordinate([...nextState.loadedRoutes, ...action.routes])
      const activeRoute = mergedRoutes.find((route) => route.id === action.routes[0].id)

      if (!activeRoute) {
        return state
      }

      return {
        ...nextState,
        loadedRoutes: mergedRoutes,
        activeRouteId: activeRoute.id,
        inputText: activeRoute.inputText,
        waypoints: activeRoute.waypoints,
        issues: activeRoute.issues,
        fitRequest: state.fitRequest + 1,
      }
    }
    case 'routes/set-active': {
      const nextActiveRoute = state.loadedRoutes.find((route) => route.id === action.routeId)

      if (!nextActiveRoute || nextActiveRoute.id === state.activeRouteId) {
        return state
      }

      // Flush the current textarea content back to the outgoing route before switching
      const loadedRoutesWithFlushedInput = state.activeRouteId
        ? state.loadedRoutes.map((route) =>
            route.id === state.activeRouteId
              ? { ...route, inputText: state.inputText }
              : route,
          )
        : state.loadedRoutes

      const flushedNextActiveRoute = loadedRoutesWithFlushedInput.find((r) => r.id === action.routeId)!

      return {
        ...state,
        loadedRoutes: loadedRoutesWithFlushedInput,
        activeRouteId: flushedNextActiveRoute.id,
        inputText: flushedNextActiveRoute.inputText,
        waypoints: flushedNextActiveRoute.waypoints,
        issues: flushedNextActiveRoute.issues,
        fitRequest: state.fitRequest + 1,
      }
    }
    case 'routes/rename': {
      if (!state.loadedRoutes.some((route) => route.id === action.routeId)) {
        return state
      }

      const nextState = withHistory(state)

      return {
        ...nextState,
        loadedRoutes: nextState.loadedRoutes.map((route) =>
          route.id === action.routeId
            ? {
                ...route,
                filename: action.filename,
              }
            : route,
        ),
      }
    }
    case 'routes/remove': {
      if (!state.loadedRoutes.some((route) => route.id === action.routeId)) {
        return state
      }

      const nextState = withHistory(state)
      const removedIndex = nextState.loadedRoutes.findIndex((route) => route.id === action.routeId)
      const remainingRoutes = nextState.loadedRoutes.filter((route) => route.id !== action.routeId)

      if (remainingRoutes.length === 0) {
        return {
          ...nextState,
          loadedRoutes: [],
          activeRouteId: null,
          inputText: '',
          waypoints: [],
          issues: [],
          fitRequest: state.fitRequest,
        }
      }

      if (state.activeRouteId !== action.routeId) {
        return {
          ...nextState,
          loadedRoutes: remainingRoutes,
        }
      }

      const nextActiveRoute = remainingRoutes[Math.min(removedIndex, remainingRoutes.length - 1)]

      return {
        ...nextState,
        loadedRoutes: remainingRoutes,
        activeRouteId: nextActiveRoute.id,
        inputText: nextActiveRoute.inputText,
        waypoints: nextActiveRoute.waypoints,
        issues: nextActiveRoute.issues,
        fitRequest: state.fitRequest + 1,
      }
    }
    case 'layout/toggle':
      return {
        ...state,
        layout: state.layout === 'wide' ? 'stacked' : 'wide',
      }
    case 'thickness/set':
      return {
        ...state,
        thicknessStep: action.value,
      }
    case 'labels/load': {
      const nextState = withHistory(state)
      return {
        ...nextState,
        loadedLabelSet: parseInUseLabels(state.inUseLabelText),
      }
    }
    case 'labels/clear': {
      if (!state.inUseLabelText && state.loadedLabelSet.length === 0) {
        return state
      }

      const nextState = withHistory(state)
      return {
        ...nextState,
        inUseLabelText: '',
        loadedLabelSet: [],
      }
    }
    default:
      return state
  }
}
