import type { EditorAction, EditorSnapshot, EditorState } from './editorTypes'
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

function syncInputText(state: EditorState, waypoints: EditorState['waypoints']) {
  return {
    ...state,
    waypoints,
    issues: validateRoute(waypoints),
    inputText: exportWpt(waypoints),
  }
}

function cloneSnapshot(state: EditorState): EditorSnapshot {
  return {
    inputText: state.inputText,
    waypoints: state.waypoints,
    issues: state.issues,
    loadedLabelSet: state.loadedLabelSet,
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
      return {
        ...nextState,
        waypoints: action.route.waypoints,
        issues: action.route.issues,
        inputText: state.inputText,
        fitRequest: action.fitToRoute ? state.fitRequest + 1 : state.fitRequest,
      }
    }
    case 'route/insert': {
      const label = nextGeneratedLabel(
        state.waypoints.map((waypoint) => waypoint.label),
        action.hidden,
      )
      const waypoint = {
        id: `${label}-${action.lat.toFixed(6)}-${action.lon.toFixed(6)}`,
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

      const otherLabels = state.waypoints
        .filter((candidate) => candidate.id !== action.waypointId)
        .map((candidate) => candidate.label)
      const normalizedLabel = normalizeWaypointLabel(trimmedLabel, waypoint.hidden, otherLabels)
      const waypoints = state.waypoints.map((candidate) =>
        candidate.id === action.waypointId
          ? {
              ...candidate,
              label: normalizedLabel,
              hidden: normalizedLabel.startsWith('+'),
            }
          : candidate,
      )

      return syncInputText(withHistory(state), waypoints)
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
        history: state.history.slice(0, -1),
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
