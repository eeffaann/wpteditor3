import { describe, expect, it } from 'vitest'
import { editorReducer, initialEditorState } from './editorReducer'
import type { EditorAction, EditorState } from './editorTypes'
import { parseRouteDocument } from '../wpt/routeDocument'
import { isRouteModified } from './editorRecovery'

const text = 'Alpha http://www.openstreetmap.org/?lat=40&lon=-75\nBROKEN\nBeta http://www.openstreetmap.org/?lat=41&lon=-76'
const route = (id: string, inputText = text) => ({ id, filename: `${id}.wpt`, ...parseRouteDocument(inputText) })
const load = (mode: EditorState['namingMode'] = 'shared') => editorReducer(
  { ...initialEditorState, namingMode: mode },
  { type: 'routes/add-folder', routes: [route('one'), route('two', text.replace('Alpha', 'Other'))] },
)

function expectSynchronized(state: EditorState) {
  const parsed = parseRouteDocument(state.inputText, state.waypoints)
  expect(state.waypoints).toEqual(parsed.waypoints)
  const active = state.loadedRoutes.find((candidate) => candidate.id === state.activeRouteId)
  if (active) {
    expect(active.inputText).toBe(state.inputText)
    expect(active.waypoints).toEqual(state.waypoints)
    expect(active.issues).toEqual(state.issues)
  }
}

describe('editor state', () => {
  it('parses source edits immediately and preserves them through map edits and undo', () => {
    const original = load()
    const typed = editorReducer(original, { type: 'input/set', value: text.replace('Alpha', 'Edited') })
    expect(typed.waypoints[0].label).toBe('Edited')
    expect(typed.loadedRoutes.every((candidate) => candidate.waypoints[0].label === 'Edited')).toBe(true)
    const reversed = editorReducer(typed, { type: 'route/reverse' })
    expect(reversed.inputText).toContain('Edited')
    expect(reversed.inputText).toContain('BROKEN')
    expectSynchronized(reversed)
    expect(editorReducer(reversed, { type: 'history/undo' }).inputText).toBe(typed.inputText)
    expect(editorReducer(typed, { type: 'history/undo' }).inputText).toBe(original.inputText)
  })

  it('defaults to independent names', () => {
    expect(initialEditorState.namingMode).toBe('independent')
    const state = editorReducer(initialEditorState, {
      type: 'routes/add-folder', routes: [route('one'), route('two', text.replace('Alpha', 'Other'))],
    })
    expect(state.loadedRoutes[0].waypoints[0].label).toBe('Alpha')
    expect(state.loadedRoutes[1].waypoints[0].label).toBe('Other')
    expect(state.loadedRoutes.every((candidate) => !isRouteModified(candidate))).toBe(true)
  })

  it('harmonizes imports in shared mode without dropping malformed lines', () => {
    const state = load()
    expect(state.loadedRoutes[1].waypoints[0].label).toBe('Alpha')
    expect(state.loadedRoutes[1].inputText).toContain('BROKEN')
    expect(state.loadedRoutes[1].issues.some((issue) => issue.content === 'BROKEN')).toBe(true)
    expect(isRouteModified(state.loadedRoutes[0])).toBe(false)
    expect(isRouteModified(state.loadedRoutes[1])).toBe(true)
  })

  it('keeps imports, source renames and popup renames independent in independent mode', () => {
    let state = load('independent')
    expect(state.loadedRoutes[1].waypoints[0].label).toBe('Other')
    state = editorReducer(state, { type: 'input/set', value: text.replace('Alpha', 'Typed') })
    expect(state.loadedRoutes[1].waypoints[0].label).toBe('Other')
    state = editorReducer(state, { type: 'route/rename-waypoint', waypointId: state.waypoints[0].id, nextLabel: 'Popup' })
    expect(state.loadedRoutes[1].waypoints[0].label).toBe('Other')
    expect(state.waypoints[0].label).toBe('Popup')
  })

  it('propagates popup renames in shared mode and undoes all affected routes together', () => {
    const original = load()
    const state = editorReducer(original, { type: 'route/rename-waypoint', waypointId: original.waypoints[0].id, nextLabel: 'Shared' })
    expect(state.loadedRoutes.every((candidate) => candidate.waypoints[0].label === 'Shared')).toBe(true)
    expect(state.loadedRoutes.every((candidate) => candidate.inputText.includes('BROKEN'))).toBe(true)
    expect(editorReducer(state, { type: 'history/undo' }).loadedRoutes).toEqual(original.loadedRoutes)
  })

  it.each(['independent', 'shared'] as const)('renames a background point in %s mode without switching routes', (mode) => {
    const original = editorReducer({ ...initialEditorState, namingMode: mode }, {
      type: 'routes/add-folder',
      routes: [
        route('one', text.replace('Alpha', 'Alpha OldAlpha')),
        route('two', text.replace('Alpha', 'Other OldOther')),
        route('three', text.replace('Alpha', 'Third')),
      ],
    })
    const state = editorReducer(original, {
      type: 'route/rename-waypoint', routeId: 'two',
      waypointId: original.loadedRoutes[1].waypoints[0].id, nextLabel: 'New Name',
    })
    expect(state.activeRouteId).toBe(original.activeRouteId)
    expect(state.fitRequest).toBe(original.fitRequest)
    expect(state.loadedRoutes[1].waypoints[0]).toMatchObject({
      label: 'New_Name', altLabels: ['OldOther'], lat: 40, lon: -75, hidden: false,
    })
    if (mode === 'shared') {
      expect(state.loadedRoutes.every((candidate) => candidate.waypoints[0].label === 'New_Name')).toBe(true)
    } else {
      expect(state.loadedRoutes[0]).toBe(original.loadedRoutes[0])
      expect(state.loadedRoutes[2]).toBe(original.loadedRoutes[2])
    }
    expect(state.loadedRoutes.every((candidate) => candidate.inputText.includes('BROKEN'))).toBe(true)
    expect(state.loadedRoutes.map((candidate) => candidate.waypoints[1])).toEqual(original.loadedRoutes.map((candidate) => candidate.waypoints[1]))
    expect(isRouteModified(state.loadedRoutes[1])).toBe(true)
    expectSynchronized(state)
    expect(editorReducer(state, { type: 'history/undo' }).loadedRoutes).toEqual(original.loadedRoutes)
  })

  it('does not rename points on missing routes or fall back to the active route', () => {
    const original = load()
    expect(editorReducer(original, {
      type: 'route/rename-waypoint', routeId: 'missing', waypointId: original.waypoints[0].id, nextLabel: 'Wrong',
    })).toBe(original)
    expect(editorReducer(original, {
      type: 'route/rename-waypoint', routeId: 'two', waypointId: 'missing', nextLabel: 'Wrong',
    })).toBe(original)
  })

  it('makes enabling shared mode undoable, including the previous independent names', () => {
    const original = load('independent')
    const state = editorReducer(original, { type: 'naming/set-mode', mode: 'shared' })
    expect(state.loadedRoutes[1].waypoints[0].label).toBe('Alpha')
    const undone = editorReducer(state, { type: 'history/undo' })
    expect(undone.namingMode).toBe('independent')
    expect(undone.loadedRoutes[1].waypoints[0].label).toBe('Other')
  })

  it('does not share hidden waypoint names', () => {
    const state = editorReducer(initialEditorState, { type: 'routes/add-folder', routes: [
      route('one', text.replace('Alpha', '+X000001')),
      route('two', text.replace('Alpha', '+X000002')),
    ] })
    expect(state.loadedRoutes[1].waypoints[0].label).toBe('+X000002')
  })

  it('keeps coordinate sharing independent of the naming mode and undoable', () => {
    const original = load('independent')
    const state = editorReducer(original, { type: 'route/update-shared-station-position', sourceLat: 40, sourceLon: -75, lat: 40.5, lon: -75.5 })
    expect(state.loadedRoutes.every((candidate) => candidate.waypoints[0].lat === 40.5)).toBe(true)
    expect(state.loadedRoutes[1].waypoints[0].label).toBe('Other')
    expect(state.loadedRoutes.every((candidate) => candidate.inputText.includes('BROKEN'))).toBe(true)
    expectSynchronized(state)
    expect(editorReducer(state, { type: 'history/undo' }).loadedRoutes).toEqual(original.loadedRoutes)
  })

  it('retains typed content when switching routes, and synchronizes Clear', () => {
    let state = load('independent')
    state = editorReducer(state, { type: 'input/set', value: text.replace('Alpha', 'Typed') })
    state = editorReducer(state, { type: 'routes/set-active', routeId: 'two' })
    state = editorReducer(state, { type: 'routes/set-active', routeId: 'one' })
    expect(state.waypoints[0].label).toBe('Typed')
    state = editorReducer(state, { type: 'route/clear' })
    expect(state.loadedRoutes[0].inputText).toBe('')
    expectSynchronized(state)
    state = editorReducer(state, { type: 'history/undo' })
    expect(state.inputText).toContain('Typed')
  })

  it('selects a route without requesting a map fit when explicitly disabled', () => {
    const original = load('independent')
    const state = editorReducer(original, { type: 'routes/set-active', routeId: 'two', fitToRoute: false })
    expect(state.activeRouteId).toBe('two')
    expect(state.waypoints[0].label).toBe('Other')
    expect(state.fitRequest).toBe(original.fitRequest)
    expectSynchronized(state)
  })

  it('still requests a map fit for normal route selection', () => {
    const original = load()
    const state = editorReducer(original, { type: 'routes/set-active', routeId: 'two' })
    expect(state.activeRouteId).toBe('two')
    expect(state.fitRequest).toBe(original.fitRequest + 1)
    expectSynchronized(state)
  })

  it.each([
    { type: 'route/insert', lat: 40.5, lon: -75.5, hidden: true, labelSeed: 654321 },
    { type: 'route/set-alt-labels', waypointId: '1-Alpha', altLabels: ['Alternate'] },
    { type: 'route/toggle-waypoint-kind', waypointId: '1-Alpha', labelSeed: 654321 },
    { type: 'route/update-waypoint-position', waypointId: '1-Alpha', lat: 40.1, lon: -75.1 },
    { type: 'route/delete-waypoint', waypointId: '1-Alpha' },
    { type: 'route/move-waypoint', fromIndex: 0, toIndex: 1 },
    { type: 'route/reuse-background-station', label: 'Reused', altLabels: [], lat: 40.5, lon: -75.5, hidden: false },
    { type: 'route/merge-background-station', deleteWaypointId: '1-Alpha', label: 'Merged', altLabels: [], lat: 40.5, lon: -75.5 },
  ] satisfies EditorAction[])('preserves malformed source and synchronized state for $type', (action) => {
    const original = load('independent')
    const state = editorReducer(original, action)
    expect(state.inputText).toContain('BROKEN')
    expect(state.issues.some((issue) => issue.content === 'BROKEN')).toBe(true)
    expectSynchronized(state)
    expect(editorReducer(state, { type: 'history/undo' }).inputText).toBe(original.inputText)
  })

  it('is deterministic for generated hidden labels', () => {
    const state = load()
    const action = { type: 'route/insert', lat: 40.5, lon: -75.5, hidden: true, labelSeed: 654321 } as const
    expect(editorReducer(state, action)).toEqual(editorReducer(state, action))
  })

  it('starts hidden labels at the supplied random seed and skips collisions, including wraparound', () => {
    let state = load('independent')
    const insert = { type: 'route/insert', lat: 40.5, lon: -75.5, hidden: true, labelSeed: 999999 } as const
    state = editorReducer(state, insert)
    expect(state.waypoints.some((waypoint) => waypoint.label === '+X999999')).toBe(true)
    state = editorReducer(state, insert)
    expect(state.waypoints.some((waypoint) => waypoint.label === '+X000000')).toBe(true)
    expect(new Set(state.waypoints.map((waypoint) => waypoint.label)).size).toBe(state.waypoints.length)
    expectSynchronized(state)
  })

  it.each(['WP1', 'WP12345'])('renames the default station %s on conversion without changing its other data', (label) => {
    const original = editorReducer(initialEditorState, { type: 'input/set', value: `${label} Alt http://www.openstreetmap.org/?lat=40&lon=-75` })
    const waypoint = original.waypoints[0]
    const action = { type: 'route/toggle-waypoint-kind', waypointId: waypoint.id, labelSeed: 123456 } as const
    const converted = editorReducer(original, action)
    expect(converted.waypoints[0]).toMatchObject({ id: waypoint.id, label: '+X123456', hidden: true, altLabels: ['Alt'], lat: 40, lon: -75 })
    expectSynchronized(converted)
    expect(editorReducer(original, action)).toEqual(converted)
    const station = editorReducer(converted, action)
    expect(station.waypoints[0]).toMatchObject({ label: 'WP1', hidden: false })
    expect(editorReducer(converted, { type: 'history/undo' }).waypoints).toEqual(original.waypoints)
  })

  it('preserves custom station names and avoids existing geometry labels on conversion', () => {
    const custom = load('independent')
    const converted = editorReducer(custom, { type: 'route/toggle-waypoint-kind', waypointId: custom.waypoints[0].id, labelSeed: 123456 })
    expect(converted.waypoints[0].label).toBe('+Alpha')
    const state = editorReducer(initialEditorState, { type: 'input/set', value: 'WP1 http://www.openstreetmap.org/?lat=40&lon=-75\n+X123456 http://www.openstreetmap.org/?lat=41&lon=-76' })
    expect(editorReducer(state, { type: 'route/toggle-waypoint-kind', waypointId: state.waypoints[0].id, labelSeed: 123456 }).waypoints[0].label).toBe('+X123457')
  })

  it.each(['use-other', 'use-current'] as const)('matches a concurrent primary name in direction %s without changing other points or alt labels', (direction) => {
    const original = load('independent')
    const other = original.loadedRoutes[1].waypoints[0]
    const state = editorReducer(original, {
      type: 'route/match-shared-name', waypointId: original.waypoints[0].id, routeId: 'two', otherWaypointId: other.id, direction,
    })
    const label = direction === 'use-other' ? 'Other' : 'Alpha'
    expect(state.loadedRoutes.every((candidate) => candidate.waypoints[0].label === label)).toBe(true)
    expect(state.loadedRoutes.every((candidate) => candidate.inputText.includes('BROKEN'))).toBe(true)
    expect(state.loadedRoutes[direction === 'use-other' ? 1 : 0]).toEqual(original.loadedRoutes[direction === 'use-other' ? 1 : 0])
    expect(state.loadedRoutes.map((candidate) => candidate.waypoints[0].altLabels)).toEqual(original.loadedRoutes.map((candidate) => candidate.waypoints[0].altLabels))
    expectSynchronized(state)
    expect(editorReducer(state, { type: 'history/undo' }).loadedRoutes).toEqual(original.loadedRoutes)
  })

  it('ignores stale concurrent-point matches after coordinates change', () => {
    const original = load('independent')
    const state = editorReducer(original, {
      type: 'route/match-shared-name', waypointId: original.waypoints[0].id, routeId: 'two',
      otherWaypointId: original.loadedRoutes[1].waypoints[1].id, direction: 'use-other',
    })
    expect(state).toBe(original)
  })

  it('changes only the chosen concurrent route in independent mode, retaining alternate names and geometry', () => {
    const original = editorReducer({ ...initialEditorState, namingMode: 'independent' }, {
      type: 'routes/add-folder',
      routes: [
        route('one', text.replace('Alpha', 'Alpha OldAlpha')),
        route('two', text.replace('Alpha', 'Other OldOther')),
        route('three', text.replace('Alpha', 'Third')),
      ],
    })
    const state = editorReducer(original, {
      type: 'route/match-shared-name', waypointId: original.waypoints[0].id, routeId: 'two',
      otherWaypointId: original.loadedRoutes[1].waypoints[0].id, direction: 'use-current',
    })
    expect(state.loadedRoutes[1].waypoints[0]).toMatchObject({
      id: original.loadedRoutes[1].waypoints[0].id, label: 'Alpha', altLabels: ['OldOther'], lat: 40, lon: -75, hidden: false,
    })
    expect(state.loadedRoutes[1].waypoints[1]).toEqual(original.loadedRoutes[1].waypoints[1])
    expect(state.loadedRoutes[0]).toBe(original.loadedRoutes[0])
    expect(state.loadedRoutes[2]).toBe(original.loadedRoutes[2])
  })

  it.each(['one', 'two'])('refreshes %s from exact disk source while preserving selection and supporting undo', (routeId) => {
    const original = load('independent')
    const inputText = text.replace('Alpha', 'Disk').replace('Beta', 'DiskEnd')
    const state = editorReducer(original, { type: 'routes/refresh', routeId, inputText })
    expect(state.activeRouteId).toBe('one')
    const refreshed = state.loadedRoutes.find((candidate) => candidate.id === routeId)!
    expect(refreshed).toMatchObject({ id: routeId, filename: `${routeId}.wpt`, inputText, originalInputText: inputText })
    expect(isRouteModified(refreshed)).toBe(false)
    expectSynchronized(state)
    expect(editorReducer(state, { type: 'history/undo' }).loadedRoutes).toEqual(original.loadedRoutes)
  })

  it('uses refreshed background station names as canonical in shared mode', () => {
    const original = load()
    const state = editorReducer(original, { type: 'routes/refresh', routeId: 'two', inputText: text.replace('Alpha', 'FromDisk') })
    expect(state.activeRouteId).toBe('one')
    expect(state.loadedRoutes.every((candidate) => candidate.waypoints[0].label === 'FromDisk')).toBe(true)
    expectSynchronized(state)
    expect(editorReducer(state, { type: 'history/undo' }).loadedRoutes).toEqual(original.loadedRoutes)
  })
})
