import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorSession } from './useEditorSession'
import { RECOVERY_KEY, restoreRecovery } from './editorRecovery'

beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('session recovery lifecycle', () => {
  it('persists and restores typed source and naming mode', () => {
    const session = renderHook(useEditorSession)
    act(() => {
      session.result.current.dispatch({ type: 'input/set', value: 'BROKEN' })
      session.result.current.dispatch({ type: 'naming/set-mode', mode: 'independent' })
    })
    act(() => vi.advanceTimersByTime(400))
    expect(restoreRecovery(localStorage.getItem(RECOVERY_KEY)!).state.inputText).toBe('BROKEN')
    session.unmount()
    const restored = renderHook(useEditorSession)
    expect(restored.result.current.state.inputText).toBe('BROKEN')
    expect(restored.result.current.state.namingMode).toBe('independent')
    expect(restored.result.current.status).toContain('Restored')
  })

  it('warns before unloading unsaved work and flushes pending recovery immediately', () => {
    const { result } = renderHook(useEditorSession)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    act(() => result.current.dispatch({ type: 'input/set', value: 'BROKEN' }))
    const dirty = new Event('beforeunload', { cancelable: true })
    act(() => window.dispatchEvent(dirty))
    expect(dirty.defaultPrevented).toBe(true)
    expect(restoreRecovery(localStorage.getItem(RECOVERY_KEY)!).state.inputText).toBe('BROKEN')
  })

  it('reports storage failures rather than silently promising recovery', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    const { result } = renderHook(useEditorSession)
    act(() => result.current.dispatch({ type: 'input/set', value: 'BROKEN' }))
    act(() => vi.advanceTimersByTime(400))
    expect(result.current.status).toContain('Quota exceeded')
  })

  it('reports corrupt recovery and does not overwrite it while untouched', () => {
    localStorage.setItem(RECOVERY_KEY, '{corrupt')
    const { result } = renderHook(useEditorSession)
    act(() => vi.advanceTimersByTime(400))
    expect(result.current.status).toContain('recovery failed')
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('{corrupt')
    act(() => window.dispatchEvent(new Event('beforeunload')))
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('{corrupt')
  })
})
