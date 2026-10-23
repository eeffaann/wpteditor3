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

  it('defaults to shared names and harmonizes imports without dropping malformed lines', () => {
    expect(initialEditorState.namingMode).toBe('shared')
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

  it.each([
    { type: 'route/insert', lat: 40.5, lon: -75.5, hidden: true },
    { type: 'route/set-alt-labels', waypointId: '1-Alpha', altLabels: ['Alternate'] },
    { type: 'route/toggle-waypoint-kind', waypointId: '1-Alpha' },
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
    const action = { type: 'route/insert', lat: 40.5, lon: -75.5, hidden: true } as const
    expect(editorReducer(state, action)).toEqual(editorReducer(state, action))
  })
})
