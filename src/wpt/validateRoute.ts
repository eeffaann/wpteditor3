import type { ParseIssue, Waypoint } from '../editor/editorTypes'
import { exportWaypointLine } from './exportWpt'

function isVisible(label: string) {
  return !(label.startsWith('+') || label.startsWith('*+'))
}

function reduceLabel(label: string) {
  return label.toLowerCase().replaceAll('+', '').replaceAll('*', '')
}

function countCharacter(text: string, character: string) {
  return text.split(character).length - 1
}

function mileage(lat1: number, lon1: number, lat2: number, lon2: number) {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0
  }

  const earthRadiusMiles = 3963
  const deg2rad = Math.PI / 180
  const angle =
    Math.cos(lat1 * deg2rad) * Math.cos(lat2 * deg2rad) * Math.cos((lon1 - lon2) * deg2rad) +
    Math.sin(lat1 * deg2rad) * Math.sin(lat2 * deg2rad)

  return Math.acos(Math.min(1, Math.max(-1, angle))) * 1.02112 * earthRadiusMiles
}

function buildIssueCollector(waypoints: Waypoint[]) {
  const issueCodesByLine = new Map<number, Set<string>>()

  function add(lineNumber: number, code: string) {
    const issueCodes = issueCodesByLine.get(lineNumber) ?? new Set<string>()
    issueCodes.add(code)
    issueCodesByLine.set(lineNumber, issueCodes)
  }

  function toIssues(): ParseIssue[] {
    return Array.from(issueCodesByLine.entries())
      .sort((left, right) => left[0] - right[0])
      .flatMap(([lineNumber, codes]) =>
        Array.from(codes).map((code) => ({
          lineNumber,
          message: code,
          content: exportWaypointLine(waypoints[lineNumber - 1]),
        })),
      )
  }

  return { add, toIssues }
}

export function validateRoute(waypoints: Waypoint[]): ParseIssue[] {
  const issues = buildIssueCollector(waypoints)

  for (let index = 0; index < waypoints.length; index += 1) {
    const waypoint = waypoints[index]
    const lineNumber = index + 1
    const labels = [waypoint.label, ...waypoint.altLabels]
    const visible = isVisible(waypoint.label)

    if (/^\*?I\-[0-9]+[EWCNS]?Bus/i.test(waypoint.label)) {
      issues.add(lineNumber, 'BUS_WITH_I')
    }

    const reducedLabels = labels.map(reduceLabel).filter(Boolean)
    const duplicateWithinWaypoint = new Set<string>()
    for (const reducedLabel of reducedLabels) {
      if (duplicateWithinWaypoint.has(reducedLabel)) {
        issues.add(lineNumber, 'DUPLICATE_LABEL')
        break
      }
      duplicateWithinWaypoint.add(reducedLabel)
    }

    const labelPattern = /^\+?\*?[a-zA-Z0-9()\/_\-.]+$/
    if (!labelPattern.test(waypoint.label) || waypoint.altLabels.some((altLabel) => !labelPattern.test(altLabel))) {
      issues.add(lineNumber, 'LABEL_INVALID_CHAR')
    }

    if (visible && /[_/]$/.test(waypoint.label)) {
      issues.add(lineNumber, 'INVALID_FINAL_CHAR')
    }

    if (/^\**[_/(]/.test(waypoint.label)) {
      issues.add(lineNumber, 'INVALID_FIRST_CHAR')
    }

    if (/^X[0-9]{6}$/i.test(waypoint.label)) {
      issues.add(lineNumber, 'LABEL_LOOKS_HIDDEN')
    }

    const lowercaseIndex = waypoint.label[0] === '*' ? 1 : 0
    const lowercaseCharacter = waypoint.label[lowercaseIndex]
    if (lowercaseCharacter && lowercaseCharacter >= 'a' && lowercaseCharacter <= 'z') {
      issues.add(lineNumber, 'LABEL_LOWERCASE')
    }

    if (visible) {
      const leftParens = countCharacter(waypoint.label, '(')
      const rightParens = countCharacter(waypoint.label, ')')
      if (
        leftParens !== rightParens ||
        leftParens > 1 ||
        (leftParens === 1 && waypoint.label.indexOf('(') > waypoint.label.indexOf(')'))
      ) {
        issues.add(lineNumber, 'LABEL_PARENS')
      }

      if (countCharacter(waypoint.label, '/') > 1) {
        issues.add(lineNumber, 'LABEL_SLASHES')
      }

      if (countCharacter(waypoint.label, '_') > 1) {
        issues.add(lineNumber, 'LABEL_UNDERSCORES')
      }

      const underscoreIndex = waypoint.label.indexOf('_')
      if (underscoreIndex >= 0 && underscoreIndex < waypoint.label.length - 4) {
        const lastCharacter = waypoint.label.at(-1) ?? ''
        if (lastCharacter < 'A' || lastCharacter > 'Z' || underscoreIndex < waypoint.label.length - 5) {
          issues.add(lineNumber, 'LONG_UNDERSCORE')
        }
      }

      if (underscoreIndex >= 0) {
        const suffixCharacter = waypoint.label[underscoreIndex + 1]
        if (suffixCharacter && suffixCharacter >= 'a' && suffixCharacter <= 'z') {
          issues.add(lineNumber, 'LOWERCASE_SUFFIX')
        }
      }

      if (/_.+\//.test(waypoint.label)) {
        issues.add(lineNumber, 'NONTERMINAL_UNDERSCORE')
      }
    }

    if (waypoint.label.length > 26) {
      issues.add(lineNumber, 'LABEL_TOO_LONG')
    }

    if (/^\*?old\d/i.test(waypoint.label)) {
      issues.add(lineNumber, 'LACKS_GENERIC')
    }

    if (/\*?US[0-9]+[AB]$|\*?US[0-9]+[AB][/_(]/.test(waypoint.label)) {
      issues.add(lineNumber, 'US_LETTER')
    }

    if (waypoint.lat > 90 || waypoint.lat < -90 || waypoint.lon > 180 || waypoint.lon < -180) {
      issues.add(lineNumber, 'OUT_OF_BOUNDS')
    }
  }

  for (let leftIndex = 0; leftIndex < waypoints.length - 1; leftIndex += 1) {
    const leftWaypoint = waypoints[leftIndex]
    const leftLabels = [leftWaypoint.label, ...leftWaypoint.altLabels].map(reduceLabel).filter(Boolean)

    for (let rightIndex = leftIndex + 1; rightIndex < waypoints.length; rightIndex += 1) {
      const rightWaypoint = waypoints[rightIndex]
      const sameCoordinates =
        leftWaypoint.lat.toFixed(6) === rightWaypoint.lat.toFixed(6) &&
        leftWaypoint.lon.toFixed(6) === rightWaypoint.lon.toFixed(6)

      if (sameCoordinates) {
        issues.add(leftIndex + 1, 'DUPLICATE_COORDS')
        issues.add(rightIndex + 1, 'DUPLICATE_COORDS')
      }

      const rightLabels = [rightWaypoint.label, ...rightWaypoint.altLabels].map(reduceLabel).filter(Boolean)
      if (leftLabels.some((leftLabel) => rightLabels.includes(leftLabel))) {
        issues.add(leftIndex + 1, 'DUPLICATE_LABEL')
        issues.add(rightIndex + 1, 'DUPLICATE_LABEL')
      }
    }
  }

  if (waypoints.length > 1) {
    if (!isVisible(waypoints[0].label)) {
      issues.add(1, 'HIDDEN_TERMINUS')
    }

    if (!isVisible(waypoints.at(-1)?.label ?? '')) {
      issues.add(waypoints.length, 'HIDDEN_TERMINUS')
    }
  }

  const deg2rad = Math.PI / 180
  for (let index = 1; index < waypoints.length - 1; index += 1) {
    const currentWaypoint = waypoints[index]
    const previousWaypoint = waypoints[index - 1]
    const nextWaypoint = waypoints[index + 1]

    const duplicatePrevious =
      currentWaypoint.lat === previousWaypoint.lat && currentWaypoint.lon === previousWaypoint.lon
    const duplicateNext = currentWaypoint.lat === nextWaypoint.lat && currentWaypoint.lon === nextWaypoint.lon

    if (duplicatePrevious || duplicateNext) {
      issues.add(index + 1, 'BAD_ANGLE')
      break
    }

    const x0 = Math.cos(previousWaypoint.lon * deg2rad) * Math.cos(previousWaypoint.lat * deg2rad)
    const x1 = Math.cos(currentWaypoint.lon * deg2rad) * Math.cos(currentWaypoint.lat * deg2rad)
    const x2 = Math.cos(nextWaypoint.lon * deg2rad) * Math.cos(nextWaypoint.lat * deg2rad)
    const y0 = Math.sin(previousWaypoint.lon * deg2rad) * Math.cos(previousWaypoint.lat * deg2rad)
    const y1 = Math.sin(currentWaypoint.lon * deg2rad) * Math.cos(currentWaypoint.lat * deg2rad)
    const y2 = Math.sin(nextWaypoint.lon * deg2rad) * Math.cos(nextWaypoint.lat * deg2rad)
    const z0 = Math.sin(previousWaypoint.lat * deg2rad)
    const z1 = Math.sin(currentWaypoint.lat * deg2rad)
    const z2 = Math.sin(nextWaypoint.lat * deg2rad)

    const numerator = (x2 - x1) * (x1 - x0) + (y2 - y1) * (y1 - y0) + (z2 - z1) * (z1 - z0)
    const denominator = Math.sqrt(
      ((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2) * ((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2),
    )

    if (denominator === 0) {
      issues.add(index + 1, 'BAD_ANGLE')
      break
    }

    const angle = (180 / Math.PI) * Math.acos(Math.min(1, Math.max(-1, numerator / denominator)))
    if (angle > 135) {
      issues.add(index + 1, 'SHARP_ANGLE')
    }
  }

  let visibleDistance = 0
  for (let index = 1; index < waypoints.length; index += 1) {
    const segmentDistance = mileage(
      waypoints[index - 1].lat,
      waypoints[index - 1].lon,
      waypoints[index].lat,
      waypoints[index].lon,
    )

    if (segmentDistance > 20) {
      issues.add(index + 1, 'LONG_SEGMENT')
    }

    visibleDistance += segmentDistance
    if (visibleDistance > 10 && (isVisible(waypoints[index].label) || index === waypoints.length - 1)) {
      issues.add(index + 1, 'VISIBLE_DISTANCE')
    }

    if (isVisible(waypoints[index].label)) {
      visibleDistance = 0
    }
  }

  return issues.toIssues()
}
