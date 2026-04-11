import type { ParsedRoute, ParseIssue, Waypoint } from '../editor/editorTypes'
import { validateRoute } from './validateRoute'

const COORDINATE_PATTERN = /^-?\d+(?:\.\d+)?$/

function parseCoordinatesFromUrl(urlText: string): { lat: number; lon: number } | null {
  try {
    const url = new URL(urlText)
    const lat = url.searchParams.get('lat')
    const lon = url.searchParams.get('lon')

    if (!lat || !lon || !COORDINATE_PATTERN.test(lat) || !COORDINATE_PATTERN.test(lon)) {
      return null
    }

    return {
      lat: Number(lat),
      lon: Number(lon),
    }
  } catch {
    return null
  }
}

function buildWaypoint(label: string, altLabels: string[], url: string, lineNumber: number): Waypoint | ParseIssue {
  const coordinates = parseCoordinatesFromUrl(url)

  if (!coordinates) {
    return {
      lineNumber,
      message: 'Expected an OpenStreetMap URL with numeric lat and lon query parameters.',
      content: `${label} ${url}`,
    }
  }

  return {
    id: `${lineNumber}-${label}`,
    label,
    altLabels,
    lat: coordinates.lat,
    lon: coordinates.lon,
    hidden: label.startsWith('+'),
    url,
  }
}

export function parseWpt(inputText: string): ParsedRoute {
  const waypoints: Waypoint[] = []
  const issues: ParseIssue[] = []

  inputText
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const lineNumber = index + 1
      const line = rawLine.trim()

      if (!line) {
        return
      }

      const parts = line.split(/\s+/)
      const label = parts[0]
      const url = parts.at(-1) ?? ''
      const altLabels = parts.length > 2 ? parts.slice(1, -1) : []

      if (!label || !url) {
        issues.push({
          lineNumber,
          message: 'Each line must contain a label followed by a URL.',
          content: rawLine,
        })
        return
      }

      const waypointOrIssue = buildWaypoint(label, altLabels, url, lineNumber)

      if ('message' in waypointOrIssue) {
        issues.push(waypointOrIssue)
        return
      }

      waypoints.push(waypointOrIssue)
    })

  return { waypoints, issues: [...issues, ...validateRoute(waypoints)] }
}

export function parseInUseLabels(inputText: string): string[] {
  return Array.from(
    new Set(
      inputText
        .split(/\s+/)
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  )
}
