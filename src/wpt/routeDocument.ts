import type { LoadedRoute, ParsedRoute, Waypoint } from '../editor/editorTypes'
import { exportWaypointLine } from './exportWpt'
import { parseWpt } from './parseWpt'
import { validateRoute } from './validateRoute'

export type RouteDocument = Pick<LoadedRoute, 'inputText' | 'waypoints' | 'issues'>

function withWaypointIds(parsed: ParsedRoute, ids: string[]): ParsedRoute {
  const waypoints = parsed.waypoints.map((waypoint, index) => ({ ...waypoint, id: ids[index] }))
  return {
    waypoints,
    issues: [
      ...parsed.issues.filter((issue) => !issue.waypointId),
      ...validateRoute(waypoints),
    ],
  }
}

export function parseRouteDocument(inputText: string, previous: Waypoint[] = []): RouteDocument {
  const parsed = parseWpt(inputText)
  const available = new Set(previous.map((waypoint) => waypoint.id))
  const used = new Set<string>()
  const ids = parsed.waypoints.map((waypoint) => {
    const match =
      previous.find((candidate) => available.has(candidate.id) && exportWaypointLine(candidate) === exportWaypointLine(waypoint)) ??
      previous.find((candidate) => available.has(candidate.id) && candidate.sourceLine === waypoint.sourceLine)
    let id = match?.id ?? waypoint.id
    let suffix = 2
    while (used.has(id) || (!match && available.has(id))) id = `${waypoint.id}-${suffix++}`
    if (match) available.delete(match.id)
    used.add(id)
    return id
  })
  return { inputText, ...withWaypointIds(parsed, ids) }
}

// Replace only waypoint slots: unparsed lines and blank lines remain in the document.
export function editRouteDocument(document: RouteDocument, nextWaypoints: Waypoint[]): RouteDocument {
  const newline = document.inputText.includes('\r\n') ? '\r\n' : '\n'
  const lines = document.inputText === '' ? [] : document.inputText.split(/\r?\n/)
  const sourceLines = new Set(document.waypoints.map((waypoint) => waypoint.sourceLine))
  const originalById = new Map(document.waypoints.map((waypoint) => [waypoint.id, waypoint]))
  const nextLines: Array<{ text: string; waypointId?: string }> = []
  let nextIndex = 0
  function render(waypoint: Waypoint) {
    const original = originalById.get(waypoint.id)
    const unchanged = original && original.label === waypoint.label &&
      original.altLabels.join(' ') === waypoint.altLabels.join(' ') &&
      original.lat === waypoint.lat && original.lon === waypoint.lon
    return {
      text: original?.sourceLine && unchanged ? lines[original.sourceLine - 1] : exportWaypointLine(waypoint),
      waypointId: waypoint.id,
    }
  }
  for (const [index, line] of lines.entries()) {
    if (sourceLines.has(index + 1)) {
      if (nextIndex < nextWaypoints.length) nextLines.push(render(nextWaypoints[nextIndex++]))
    } else {
      nextLines.push({ text: line })
    }
  }
  if (nextIndex < nextWaypoints.length) {
    let insertIndex = nextLines.length
    while (insertIndex > 0 && nextLines[insertIndex - 1].text === '') insertIndex--
    nextLines.splice(insertIndex, 0, ...nextWaypoints.slice(nextIndex).map(render))
  }
  const inputText = nextLines.map((line) => line.text).join(newline)
  const parsed = parseWpt(inputText)
  const idsByLine = new Map(nextLines.map((line, index) => [index + 1, line.waypointId]))
  return {
    inputText,
    ...withWaypointIds(parsed, parsed.waypoints.map((waypoint) => idsByLine.get(waypoint.sourceLine ?? 0) ?? waypoint.id)),
  }
}
