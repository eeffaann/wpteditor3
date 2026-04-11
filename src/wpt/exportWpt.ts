import type { Waypoint } from '../editor/editorTypes'

function toFixedCoordinate(value: number): string {
  return value.toFixed(6)
}

export function buildOsmUrl(lat: number, lon: number): string {
  return `http://www.openstreetmap.org/?lat=${toFixedCoordinate(lat)}&lon=${toFixedCoordinate(lon)}`
}

export function exportWaypointLine(waypoint: Waypoint): string {
  const altLabelsText = waypoint.altLabels.length > 0 ? ` ${waypoint.altLabels.join(' ')}` : ''
  return `${waypoint.label}${altLabelsText} ${buildOsmUrl(waypoint.lat, waypoint.lon)}`
}

export function exportWpt(waypoints: Waypoint[]): string {
  return waypoints.map((waypoint) => exportWaypointLine(waypoint)).join('\n')
}
