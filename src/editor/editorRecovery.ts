import type { EditorState } from './editorTypes'
import { initialEditorState } from './editorReducer'
import { parseRouteDocument } from '../wpt/routeDocument'

export const RECOVERY_KEY = 'wpteditor3.workspace.v1'
export type SavedSources = Record<string, { filename: string; inputText: string }>

export function isRouteDirty(state: EditorState, saved: SavedSources, routeId: string) {
  const route = state.loadedRoutes.find((candidate) => candidate.id === routeId)
  const baseline = saved[routeId]
  return !!route && (!baseline || baseline.inputText !== route.inputText || baseline.filename !== route.filename)
}

export function hasUnsavedChanges(state: EditorState, saved: SavedSources) {
  return state.loadedRoutes.some((route) => isRouteDirty(state, saved, route.id)) ||
    (!state.activeRouteId && state.inputText !== '')
}

export function serializeRecovery(state: EditorState, savedSources: SavedSources) {
  return JSON.stringify({
    version: 1,
    routes: state.loadedRoutes.map(({ id, filename, inputText }) => ({ id, filename, inputText })),
    activeRouteId: state.activeRouteId,
    inputText: state.inputText,
    namingMode: state.namingMode,
    savedSources,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function restoreRecovery(text: string): { state: EditorState; savedSources: SavedSources } {
  const data: unknown = JSON.parse(text)
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.routes) ||
      typeof data.inputText !== 'string' ||
      (data.namingMode !== 'shared' && data.namingMode !== 'independent') ||
      (data.activeRouteId !== null && typeof data.activeRouteId !== 'string') ||
      !isRecord(data.savedSources)) throw new Error('Invalid workspace recovery data.')

  const ids = new Set<string>()
  const loadedRoutes = data.routes.map((route: unknown) => {
    if (!isRecord(route) || typeof route.id !== 'string' || typeof route.filename !== 'string' ||
        typeof route.inputText !== 'string' || ids.has(route.id)) throw new Error('Invalid recovered route.')
    ids.add(route.id)
    return { id: route.id, filename: route.filename, ...parseRouteDocument(route.inputText) }
  })
  const savedSources: SavedSources = {}
  for (const [id, baseline] of Object.entries(data.savedSources)) {
    if (!isRecord(baseline) || typeof baseline.filename !== 'string' || typeof baseline.inputText !== 'string') {
      throw new Error('Invalid recovered save information.')
    }
    Object.defineProperty(savedSources, id, {
      value: { filename: baseline.filename, inputText: baseline.inputText },
      enumerable: true, configurable: true, writable: true,
    })
  }
  const active = loadedRoutes.find((route) => route.id === data.activeRouteId)
  if (data.activeRouteId !== null && !active) throw new Error('The recovered active route is missing.')
  return {
    state: {
      ...initialEditorState,
      loadedRoutes,
      activeRouteId: data.activeRouteId,
      namingMode: data.namingMode,
      ...(active ?? parseRouteDocument(data.inputText)),
      fitRequest: 1,
    },
    savedSources,
  }
}
