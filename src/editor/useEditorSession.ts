import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { editorReducer, initialEditorState } from './editorReducer'
import { hasUnsavedChanges, RECOVERY_KEY, restoreRecovery, serializeRecovery, type SavedSources } from './editorRecovery'
import { errorMessage } from './routeFiles'

function loadSession() {
  try {
    const stored = localStorage.getItem(RECOVERY_KEY)
    return stored
      ? { ...restoreRecovery(stored), status: 'Restored workspace. File access must be selected again before saving.', recoveryFailed: false }
      : { state: initialEditorState, savedSources: {} as SavedSources, status: null, recoveryFailed: false }
  } catch (error) {
    return {
      state: initialEditorState,
      savedSources: {} as SavedSources,
      status: `Workspace recovery failed: ${errorMessage(error)}`,
      recoveryFailed: true,
    }
  }
}

export function useEditorSession() {
  const [session] = useState(loadSession)
  const [state, dispatch] = useReducer(editorReducer, session.state)
  const [savedSources, setSavedSources] = useState(session.savedSources)
  const [status, setStatus] = useState<string | null>(session.status)
  const current = useRef({ state, savedSources })
  useEffect(() => { current.current = { state, savedSources } }, [state, savedSources])

  const markSaved = useCallback((id: string, filename: string, inputText: string) => {
    setSavedSources((previous) => ({ ...previous, [id]: { filename, inputText } }))
  }, [])

  const persist = useCallback(() => {
    if (session.recoveryFailed && current.current.state === session.state) return
    try {
      localStorage.setItem(RECOVERY_KEY, serializeRecovery(current.current.state, current.current.savedSources))
    } catch (error) {
      setStatus(`Workspace recovery could not be saved: ${errorMessage(error)}. Save your routes to disk.`)
    }
  }, [session])

  useEffect(() => {
    const timer = window.setTimeout(persist, 400)
    return () => window.clearTimeout(timer)
  }, [state, savedSources, persist])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      persist()
      if (hasUnsavedChanges(current.current.state, current.current.savedSources)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('pagehide', persist)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [persist])

  return { state, dispatch, savedSources, markSaved, status, setStatus }
}
