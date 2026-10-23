import { describe, expect, it } from 'vitest'
import { editorReducer, initialEditorState } from './editorReducer'
import { hasUnsavedChanges, isRouteDirty, restoreRecovery, serializeRecovery } from './editorRecovery'
import { parseRouteDocument } from '../wpt/routeDocument'

const text = '\nAlpha http://www.openstreetmap.org/?lat=40&lon=-75\nBROKEN\n'
const route = { id: 'one', filename: 'one.wpt', ...parseRouteDocument(text) }
const loaded = editorReducer(initialEditorState, { type: 'routes/add-route', route })
const saved = { one: { filename: route.filename, inputText: text } }

describe('workspace recovery and dirty tracking', () => {
  it('round-trips source, mode, active route, diagnostics and save baselines', () => {
    const state = editorReducer(loaded, { type: 'naming/set-mode', mode: 'independent' })
    const restored = restoreRecovery(serializeRecovery(state, saved))
    expect(restored.state.inputText).toBe(text)
    expect(restored.state.activeRouteId).toBe('one')
    expect(restored.state.namingMode).toBe('independent')
    expect(restored.state.waypoints).toEqual(state.waypoints)
    expect(restored.state.issues).toEqual(state.issues)
    expect(restored.savedSources).toEqual(saved)
    expect(hasUnsavedChanges(restored.state, restored.savedSources)).toBe(false)
  })

  it('recovers an unregistered source draft too', () => {
    const state = editorReducer(initialEditorState, { type: 'input/set', value: text })
    const restored = restoreRecovery(serializeRecovery(state, {}))
    expect(restored.state.inputText).toBe(text)
    expect(restored.state.waypoints).toHaveLength(1)
    expect(hasUnsavedChanges(restored.state, {})).toBe(true)
  })

  it('tracks edits, renames, undo and save-during-edit baselines by exact saved bytes', () => {
    expect(isRouteDirty(loaded, saved, 'one')).toBe(false)
    const edited = editorReducer(loaded, { type: 'input/set', value: text.replace('Alpha', 'Edited') })
    expect(isRouteDirty(edited, saved, 'one')).toBe(true)
    expect(isRouteDirty(editorReducer(edited, { type: 'history/undo' }), saved, 'one')).toBe(false)
    const renamed = editorReducer(loaded, { type: 'routes/rename', routeId: 'one', filename: 'renamed.wpt' })
    expect(isRouteDirty(renamed, saved, 'one')).toBe(true)
    const savedAfterEdit = { one: { filename: 'one.wpt', inputText: edited.inputText } }
    expect(isRouteDirty(edited, savedAfterEdit, 'one')).toBe(false)
    expect(isRouteDirty(loaded, savedAfterEdit, 'one')).toBe(true)
  })

  it.each(['null', '{}', '{invalid', '{"version":99}'])('rejects corrupt/incompatible recovery: %s', (source) => {
    expect(() => restoreRecovery(source)).toThrow()
  })

  it('rejects missing active routes and duplicate route ids', () => {
    const source = JSON.parse(serializeRecovery(loaded, saved))
    expect(() => restoreRecovery(JSON.stringify({ ...source, activeRouteId: 'missing' }))).toThrow()
    expect(() => restoreRecovery(JSON.stringify({ ...source, routes: [route, route] }))).toThrow()
  })
})
