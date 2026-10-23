import { describe, expect, it } from 'vitest'
import { parseWpt } from './parseWpt'
import { editRouteDocument, parseRouteDocument } from './routeDocument'
import { exportWpt } from './exportWpt'
import { mileage, sameCoordinate, toMercatorPoint } from './geometry'

const first = 'Alpha Alt http://www.openstreetmap.org/?lat=40&lon=-75'
const second = 'Beta http://www.openstreetmap.org/?lat=41&lon=-76'

describe('route documents', () => {
  it('round-trips labels, alternate labels, hidden points and coordinates', () => {
    const parsed = parseWpt(`${first}\n+X000001 http://www.openstreetmap.org/?lat=40.5&lon=-75.5`)
    const roundTrip = parseWpt(exportWpt(parsed.waypoints))
    expect(roundTrip.waypoints.map(({ label, altLabels, lat, lon, hidden }) => ({ label, altLabels, lat, lon, hidden })))
      .toEqual(parsed.waypoints.map(({ label, altLabels, lat, lon, hidden }) => ({ label, altLabels, lat, lon, hidden })))
  })

  it('uses source lines and waypoint identities for validation after blank and invalid lines', () => {
    const parsed = parseWpt(`\nBROKEN\n${first.replace('Alpha', 'lowercase')}`)
    expect(parsed.issues.find((issue) => issue.message === 'LABEL_LOWERCASE')).toMatchObject({
      lineNumber: 3, waypointId: parsed.waypoints[0].id,
    })
    expect(parsed.issues.find((issue) => issue.lineNumber === 2)).not.toHaveProperty('waypointId')
  })

  it('preserves invalid lines, blank lines, CRLF, unchanged formatting and waypoint ids during reordering', () => {
    const source = `\r\n  ${first}  \r\nBROKEN\r\n\r\n${second}\r\n`
    const original = parseRouteDocument(source)
    const edited = editRouteDocument(original, [...original.waypoints].reverse())
    expect(edited.inputText).toBe(`\r\n${second}\r\nBROKEN\r\n\r\n  ${first}  \r\n`)
    expect(edited.waypoints.map((waypoint) => waypoint.id)).toEqual(original.waypoints.map((waypoint) => waypoint.id).reverse())
    expect(edited.issues.some((issue) => issue.lineNumber === 3 && issue.content === 'BROKEN')).toBe(true)
  })

  it('preserves invalid text through insertion and deleting every parsed waypoint', () => {
    const original = parseRouteDocument(`BROKEN\n${first}\n`)
    const extra = parseWpt(second).waypoints[0]
    const inserted = editRouteDocument(original, [...original.waypoints, { ...extra, id: 'new' }])
    expect(inserted.inputText).toContain('BROKEN')
    expect(inserted.waypoints).toHaveLength(2)
    const deleted = editRouteDocument(inserted, [])
    expect(deleted.inputText).toBe('BROKEN\n')
    expect(deleted.issues).toHaveLength(1)
  })

  it('keeps stable unique ids when source lines move or labels change', () => {
    const original = parseRouteDocument(`${first}\n${second}`)
    const moved = parseRouteDocument(`\n${first}\n${second}`, original.waypoints)
    expect(moved.waypoints.map((waypoint) => waypoint.id)).toEqual(original.waypoints.map((waypoint) => waypoint.id))
    const renamed = parseRouteDocument(moved.inputText.replace('Alpha', 'Renamed'), moved.waypoints)
    expect(renamed.waypoints[0].id).toBe(original.waypoints[0].id)
    expect(new Set(renamed.waypoints.map((waypoint) => waypoint.id)).size).toBe(2)
  })

  it('does not shift waypoint identities when an edited point becomes invalid', () => {
    const original = parseRouteDocument(`${first}\n${second}`)
    const edited = editRouteDocument(original, [{ ...original.waypoints[0], lat: 100 }, original.waypoints[1]])
    expect(edited.waypoints).toHaveLength(1)
    expect(edited.waypoints[0].id).toBe(original.waypoints[1].id)
    expect(edited.issues.some((issue) => issue.lineNumber === 1 && !issue.waypointId)).toBe(true)
  })

  it('serializes coordinate edits even when the prior source had more precision', () => {
    const original = parseRouteDocument(first.replace('lat=40', 'lat=40.1234567'))
    const edited = editRouteDocument(original, [{ ...original.waypoints[0], lat: 40.123457 }])
    expect(edited.waypoints[0].lat).toBe(40.123457)
    expect(edited.inputText).toContain('lat=40.123457&')
  })

  it.each(['91', '-91', '9'.repeat(400)])('keeps invalid latitude %s out of map geometry', (lat) => {
    const parsed = parseWpt(`Bad http://www.openstreetmap.org/?lat=${lat}&lon=0`)
    expect(parsed.waypoints).toHaveLength(0)
    expect(parsed.issues).toHaveLength(1)
  })

  it('continues angle validation after a duplicate segment', () => {
    const parsed = parseWpt([40, 40, 41, 41].map((lat, index) =>
      `Point${index} http://www.openstreetmap.org/?lat=${lat}&lon=-75`).join('\n'))
    expect(parsed.issues.filter((issue) => issue.message === 'BAD_ANGLE').map((issue) => issue.lineNumber)).toEqual([2, 3])
  })

  it('uses finite Mercator coordinates at the poles and consistent distance/key helpers', () => {
    expect(Number.isFinite(toMercatorPoint(90, 0).y)).toBe(true)
    expect(Number.isFinite(toMercatorPoint(-90, 0).y)).toBe(true)
    expect(mileage(40, -75, 40, -75)).toBe(0)
    expect(mileage(40, -75, 41, -75)).toBeGreaterThan(69)
    expect(sameCoordinate(40.0000001, -75, 40.0000002, -75)).toBe(true)
  })
})
