import { useCallback, useEffect, useMemo, useRef, useState, startTransition, type ChangeEvent, type ClipboardEvent } from 'react'
import './App.css'
import { useEditorSession } from './editor/useEditorSession'
import { isRouteDirty, isRouteModified } from './editor/editorRecovery'
import { collectWptFileHandles, errorMessage, writeRouteFile, type RouteFileHandle, type RoutePickerWindow } from './editor/routeFiles'
import type { LoadedRoute } from './editor/editorTypes'
import { RouteMap, type RouteMapProps } from './map/RouteMap'
import { parseWpt } from './wpt/parseWpt'
import { RouteTable } from './editor/RouteTable'

function renderRouteSourceHighlight(inputText: string) {
  const lines = inputText.split('\n')

  return lines.map((line, index) => {
    const firstWhitespaceIndex = line.search(/\s/)
    const label = firstWhitespaceIndex === -1 ? line : line.slice(0, firstWhitespaceIndex)
    const remainder = firstWhitespaceIndex === -1 ? '' : line.slice(firstWhitespaceIndex)

    return (
      <span
        key={`route-source-line-${index}`}
        className="route-source-line"
        data-line-index={index}
      >
        {label ? <strong className="route-source-label-token">{label}</strong> : null}
        {remainder || (!label ? ' ' : null)}
      </span>
    )
  })
}

function buildLoadedRoute(filename: string, inputText: string): LoadedRoute {
  const parsedRoute = parseWpt(inputText)
  return {
    id: crypto.randomUUID(),
    filename,
    inputText,
    originalInputText: inputText,
    waypoints: parsedRoute.waypoints,
    issues: parsedRoute.issues,
  }
}

function EditorApp({ onNewSession }: { onNewSession: () => void }) {
  const { state, dispatch, savedSources, markSaved, clearWorkspace, status: fileSaveStatus, setStatus: setFileSaveStatus } = useEditorSession()
  const [focusedWaypointId, setFocusedWaypointId] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [mapWrapperHeight, setMapWrapperHeight] = useState<number | null>(null)
  const routeSourceRef = useRef<HTMLTextAreaElement | null>(null)
  const routeSourceHighlightRef = useRef<HTMLPreElement | null>(null)
  const routeTableShellRef = useRef<HTMLDivElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const mapWrapperRef = useRef<HTMLElement | null>(null)
  const routeFileHandlesRef = useRef(new Map<string, { handle: RouteFileHandle; filename: string }>())
  const fileOperationRouteIdsRef = useRef(new Set<string>())
  const [fileOperationRouteIds, setFileOperationRouteIds] = useState<Set<string>>(new Set())
  const currentRoutesRef = useRef(state.loadedRoutes)
  const pendingTableHoverScrollFrameRef = useRef<number | null>(null)
  const pendingSourceHoverScrollFrameRef = useRef<number | null>(null)
  const lastHoveredWaypointIdRef = useRef<string | null>(null)
  const lastHoveredRouteRowRef = useRef<number | null>(null)

  useEffect(() => {
    currentRoutesRef.current = state.loadedRoutes
  }, [state.loadedRoutes])

  useEffect(() => {
    const folderInput = folderInputRef.current
    if (!folderInput) {
      return
    }

    folderInput.setAttribute('webkitdirectory', '')
    folderInput.setAttribute('directory', '')
  }, [])

  useEffect(
    () => () => {
      if (pendingTableHoverScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingTableHoverScrollFrameRef.current)
      }

      if (pendingSourceHoverScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingSourceHoverScrollFrameRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    let frameId = 0

    const updateMapWrapperHeight = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        const mapWrapper = mapWrapperRef.current
        if (!mapWrapper) {
          return
        }

        const rect = mapWrapper.getBoundingClientRect()
        const nextHeight = Math.max(320, Math.floor(window.innerHeight - rect.top - 14))
        setMapWrapperHeight((current) => (current === nextHeight ? current : nextHeight))
      })
    }

    updateMapWrapperHeight()

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updateMapWrapperHeight())
    const heroPanel = document.querySelector('.hero-panel')
    if (heroPanel && resizeObserver) {
      resizeObserver.observe(heroPanel)
    }

    window.addEventListener('resize', updateMapWrapperHeight)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateMapWrapperHeight)
      resizeObserver?.disconnect()
    }
  }, [])

  const lineWeight = 4

  const backgroundRoutes = useMemo(
    () =>
      state.loadedRoutes
        .filter((route) => route.id !== state.activeRouteId)
        .map((route) => ({
          id: route.id,
          filename: route.filename,
          waypoints: route.waypoints,
        })),
    [state.activeRouteId, state.loadedRoutes],
  )

  const activeRouteFilename = useMemo(
    () => state.loadedRoutes.find((route) => route.id === state.activeRouteId)?.filename ?? null,
    [state.activeRouteId, state.loadedRoutes],
  )

  const routeSourceHighlightNodes = useMemo(
    () => (state.inputText ? renderRouteSourceHighlight(state.inputText) : ' '),
    [state.inputText],
  )

  function nextGeneratedRouteFilename() {
    const existingNames = new Set(state.loadedRoutes.map((route) => route.filename.toLowerCase()))

    for (let index = 1; index < 10_000; index += 1) {
      const candidate = `route-${index}.wpt`
      if (!existingNames.has(candidate.toLowerCase())) {
        return candidate
      }
    }

    return `route-${Date.now()}.wpt`
  }

  function normalizeRouteFilename(rawFilename: string) {
    const trimmed = rawFilename.trim().replace(/\\/g, '/').split('/').at(-1)?.trim() ?? ''
    if (!trimmed) {
      return null
    }

    return trimmed.toLowerCase().endsWith('.wpt') ? trimmed : `${trimmed}.wpt`
  }

  function canSaveRouteToFile() {
    const pickerWindow = window as RoutePickerWindow
    return typeof pickerWindow.showSaveFilePicker === 'function'
  }

  function handleAddRoute() {
    const inputText = state.inputText.trim()
    if (!inputText) {
      return
    }

    const parsedRoute = parseWpt(state.inputText)
    const filename = nextGeneratedRouteFilename()
    const routeId = crypto.randomUUID()

    startTransition(() => {
      dispatch({
        type: 'routes/add-route',
        route: {
          id: routeId,
          filename,
          inputText: state.inputText,
          originalInputText: state.activeRouteId ? state.inputText : state.draftBaseline ?? state.inputText,
          waypoints: parsedRoute.waypoints,
          issues: parsedRoute.issues,
        },
      })
    })
  }

  function handleReplaceRoute() {
    const inputText = state.inputText.trim()
    if (!inputText) {
      return
    }

    const parsedRoute = parseWpt(state.inputText)
    const activeRoute = state.loadedRoutes.find((route) => route.id === state.activeRouteId)
    const filename = activeRoute?.filename ?? nextGeneratedRouteFilename()
    const routeId = activeRoute?.id ?? crypto.randomUUID()

    startTransition(() => {
      dispatch({
        type: 'routes/replace-active-route',
        route: {
          id: routeId,
          filename,
          inputText: state.inputText,
          originalInputText: activeRoute?.originalInputText ?? state.draftBaseline ?? state.inputText,
          waypoints: parsedRoute.waypoints,
          issues: parsedRoute.issues,
        },
      })
    })
  }

  function handleSaveToTab() {
    const text = state.inputText

    if (!text) {
      return
    }

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  const handleMapInsert = useCallback((hidden: boolean, lat: number, lon: number) => {
    startTransition(() => {
      dispatch({ type: 'route/insert', hidden, lat, lon, labelSeed: Math.floor(Math.random() * 1_000_000) })
    })
  }, [dispatch])

  const handleRenameWaypoint = useCallback((waypointId: string, nextLabel: string) => {
    dispatch({ type: 'route/rename-waypoint', waypointId, nextLabel })
  }, [dispatch])

  const handleMatchSharedName = useCallback<RouteMapProps['onMatchSharedName']>((waypointId, routeId, otherWaypointId, direction) => {
    dispatch({ type: 'route/match-shared-name', waypointId, routeId, otherWaypointId, direction })
  }, [dispatch])

  const handleSetAltLabels = useCallback((waypointId: string, altLabels: string[]) => {
    dispatch({ type: 'route/set-alt-labels', waypointId, altLabels })
  }, [dispatch])

  const handleToggleWaypointKind = useCallback((waypointId: string) => {
    startTransition(() => {
      dispatch({ type: 'route/toggle-waypoint-kind', waypointId, labelSeed: Math.floor(Math.random() * 1_000_000) })
    })
  }, [dispatch])

  const handleDeleteWaypoint = useCallback((waypointId: string) => {
    startTransition(() => {
      dispatch({ type: 'route/delete-waypoint', waypointId })
    })
  }, [dispatch])

  function handleMoveWaypoint(fromIndex: number, toIndex: number) {
    startTransition(() => {
      dispatch({ type: 'route/move-waypoint', fromIndex, toIndex })
    })
  }

  const handleMoveWaypointPosition = useCallback((waypointId: string, lat: number, lon: number) => {
    startTransition(() => {
      dispatch({ type: 'route/update-waypoint-position', waypointId, lat, lon })
    })
  }, [dispatch])

  const handleMoveSharedStationPosition = useCallback((sourceLat: number, sourceLon: number, lat: number, lon: number) => {
    startTransition(() => {
      dispatch({ type: 'route/update-shared-station-position', sourceLat, sourceLon, lat, lon })
    })
  }, [dispatch])

  const handleReuseBackgroundStation = useCallback((label: string, altLabels: string[], lat: number, lon: number, hidden: boolean) => {
    startTransition(() => {
      dispatch({ type: 'route/reuse-background-station', label, altLabels, lat, lon, hidden })
    })
  }, [dispatch])

  const handleMergeBackgroundStation = useCallback((deleteWaypointId: string, label: string, altLabels: string[], lat: number, lon: number) => {
    startTransition(() => {
      dispatch({ type: 'route/merge-background-station', deleteWaypointId, label, altLabels, lat, lon })
    })
  }, [dispatch])

  function handleReverseRoute() {
    startTransition(() => {
      dispatch({ type: 'route/reverse' })
    })
  }

  function handleClearRoute() {
    startTransition(() => {
      dispatch({ type: 'route/clear' })
    })
  }

  function handleNewSession() {
    if (fileOperationRouteIdsRef.current.size > 0) {
      setFileSaveStatus('Wait for the current file operation to finish before starting a new session.')
      return
    }
    if (!window.confirm('Start a new session? This clears all loaded routes, source text, undo history, and recovery data. Any work not saved locally will be lost. Files on disk will not be deleted.')) return
    if (clearWorkspace()) onNewSession()
  }

  function handleUndo() {
    startTransition(() => {
      dispatch({ type: 'history/undo' })
    })
  }

  const handleSelectWaypoint = useCallback((waypointId: string) => {
    setFocusedWaypointId(waypointId)
  }, [setFocusedWaypointId])

  function handleFocusWaypoint(waypointId: string) {
    setFocusedWaypointId(waypointId)
    setFocusRequest((current) => current + 1)
  }

  function handleRouteSourceScroll() {
    const textarea = routeSourceRef.current
    const highlight = routeSourceHighlightRef.current

    if (!textarea || !highlight) {
      return
    }

    highlight.scrollTop = textarea.scrollTop
    highlight.scrollLeft = textarea.scrollLeft
  }

  function handleInitialSourcePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (state.activeRouteId || state.inputText) return
    const text = event.clipboardData.getData('text').replace(/\r\n?/g, '\n')
    if (!text) return
    event.preventDefault()
    dispatch({ type: 'input/set', value: text, draftBaseline: text, fitToRoute: true })
  }

  function scrollRouteSourceToLine(lineIndex: number) {
    if (lastHoveredRouteRowRef.current === lineIndex) {
      return
    }

    lastHoveredRouteRowRef.current = lineIndex

    if (pendingSourceHoverScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingSourceHoverScrollFrameRef.current)
    }

    pendingSourceHoverScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingSourceHoverScrollFrameRef.current = null

    const textarea = routeSourceRef.current
    const highlight = routeSourceHighlightRef.current

    if (!textarea || !highlight) {
      return
    }

    const lineElement = highlight.querySelector(`[data-line-index="${lineIndex}"]`) as HTMLElement | null
    if (!lineElement) {
      return
    }

    const lineTop = lineElement.offsetTop
    const lineBottom = lineTop + lineElement.offsetHeight
    const scrollTop = textarea.scrollTop
    const scrollBottom = scrollTop + textarea.clientHeight

    if (lineTop < scrollTop) {
      textarea.scrollTop = lineTop
    } else if (lineBottom > scrollBottom) {
      textarea.scrollTop = lineBottom - textarea.clientHeight
    }

    highlight.scrollTop = textarea.scrollTop
    })
  }

  async function handleFolderInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
      .filter((file) => file.name.toLowerCase().endsWith('.wpt'))
      .sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name))

    if (files.length === 0) {
      return
    }

    try {
      const routes = await Promise.all(files.map(async (file) =>
        buildLoadedRoute(file.webkitRelativePath || file.name, await file.text())))
      for (const route of routes) markSaved(route.id, route.filename, route.inputText)
      dispatch({ type: 'routes/add-folder', routes })
      setFileSaveStatus('Added folder. Direct save-back is unavailable for these routes; use Save As or Download. Shared-name mode may mark imported routes as modified.')
      setFocusedWaypointId(null)
      setFocusRequest(0)
    } catch (error) {
      setFileSaveStatus(`Unable to read folder: ${errorMessage(error)}`)
    } finally {
      input.value = ''
    }
  }

  async function handleAddFolder() {
    const pickerWindow = window as RoutePickerWindow

    if (!pickerWindow.showDirectoryPicker) {
      folderInputRef.current?.click()
      return
    }

    try {
      const directoryHandle = await pickerWindow.showDirectoryPicker()
      const fileEntries = await collectWptFileHandles(directoryHandle)

      if (fileEntries.length === 0) {
        setFileSaveStatus('No .wpt files were found in the selected folder.')
        return
      }

      const routes = await Promise.all(
        fileEntries.map(async ({ relativePath, handle }) => {
          return { route: buildLoadedRoute(relativePath, await (await handle.getFile()).text()), handle }
        }),
      )
      for (const { route, handle } of routes) {
        routeFileHandlesRef.current.set(route.id, { handle, filename: route.filename })
        markSaved(route.id, route.filename, route.inputText)
      }
      dispatch({ type: 'routes/add-folder', routes: routes.map(({ route }) => route) })
      setFileSaveStatus(`Added ${routes.length} file-backed route${routes.length === 1 ? '' : 's'}. Shared-name mode may mark imported routes as modified.`)
      setFocusedWaypointId(null)
      setFocusRequest(0)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      setFileSaveStatus(`Unable to open folder: ${errorMessage(error)}`)
    }
  }

  function handleSetActiveRoute(routeId: string) {
    dispatch({ type: 'routes/set-active', routeId })
    setFocusedWaypointId(null)
    setFocusRequest((current) => current + 1)
  }

  function handleRenameRoute(routeId: string) {
    const route = state.loadedRoutes.find((candidate) => candidate.id === routeId)
    if (!route) {
      return
    }

    const proposedFilename = window.prompt('Rename route file', route.filename)
    if (proposedFilename === null) {
      return
    }

    const filename = normalizeRouteFilename(proposedFilename)
    if (!filename || filename === route.filename) {
      return
    }

    setFileSaveStatus(`Renamed ${route.filename} to ${filename}. Save will use Save As next time.`)

    startTransition(() => {
      dispatch({ type: 'routes/rename', routeId, filename })
    })
  }

  function handleRemoveRoute(routeId: string) {
    if (isRouteDirty(state, savedSources, routeId) && !window.confirm('Remove this route with unsaved changes? You can undo removal during this session.')) return
    startTransition(() => {
      dispatch({ type: 'routes/remove', routeId })
    })
    setFocusedWaypointId(null)
    setFocusRequest((current) => current + 1)
  }

  async function handleSaveRouteToFile(routeId: string) {
    const route = state.loadedRoutes.find((candidate) => candidate.id === routeId)
    if (!route || fileOperationRouteIdsRef.current.has(routeId)) return
    fileOperationRouteIdsRef.current.add(routeId)
    setFileOperationRouteIds(new Set(fileOperationRouteIdsRef.current))
    try {
      const entry = routeFileHandlesRef.current.get(routeId)
      let handle = entry?.filename === route.filename ? entry.handle : undefined
      if (!handle) {
        const pickerWindow = window as RoutePickerWindow
        if (!pickerWindow.showSaveFilePicker) {
          setFileSaveStatus('Direct saving is unavailable. Use Download or Save to Tab.')
          return
        }
        handle = await pickerWindow.showSaveFilePicker({
          suggestedName: route.filename.split('/').at(-1) ?? route.filename,
          types: [
            {
              description: 'TravelMapping waypoint files',
              accept: { 'text/plain': ['.wpt'] },
            },
          ],
        })
      }
      await writeRouteFile(handle, route.inputText)
      routeFileHandlesRef.current.set(routeId, { handle, filename: route.filename })
      markSaved(routeId, route.filename, route.inputText)
      setFileSaveStatus(`Saved ${route.filename} to disk.`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setFileSaveStatus(`Unable to save ${route.filename}: ${errorMessage(error)}`)
    } finally {
      fileOperationRouteIdsRef.current.delete(routeId)
      setFileOperationRouteIds(new Set(fileOperationRouteIdsRef.current))
    }
  }

  async function handleRefreshRoute(routeId: string) {
    const route = state.loadedRoutes.find((candidate) => candidate.id === routeId)
    if (!route || fileOperationRouteIdsRef.current.has(routeId)) return
    const entry = routeFileHandlesRef.current.get(routeId)
    if (!entry) {
      setFileSaveStatus(`No linked file for ${route.filename}. Open its folder with Add Folder or save it to a file before refreshing.`)
      return
    }
    if (isRouteDirty(state, savedSources, routeId) &&
        !window.confirm(`Refresh ${route.filename} from disk and replace its unsaved edits? You can undo this refresh.`)) return

    fileOperationRouteIdsRef.current.add(routeId)
    setFileOperationRouteIds(new Set(fileOperationRouteIdsRef.current))
    try {
      const inputText = await (await entry.handle.getFile()).text()
      const currentRoute = currentRoutesRef.current.find((candidate) => candidate.id === routeId)
      if (!currentRoute || currentRoute.inputText !== route.inputText || currentRoute.filename !== route.filename) {
        setFileSaveStatus(`Refresh cancelled: ${route.filename} changed or was removed while reading the file. Your edits were kept.`)
        return
      }
      dispatch({ type: 'routes/refresh', routeId, inputText })
      markSaved(routeId, entry.filename, inputText)
      setFileSaveStatus(`Refreshed ${route.filename} from ${entry.handle.name}.`)
    } catch (error) {
      setFileSaveStatus(`Unable to refresh ${route.filename}: ${errorMessage(error)}`)
    } finally {
      fileOperationRouteIdsRef.current.delete(routeId)
      setFileOperationRouteIds(new Set(fileOperationRouteIdsRef.current))
    }
  }

  const handleHoverWaypoint = useCallback((waypointId: string) => {
    if (lastHoveredWaypointIdRef.current === waypointId) {
      return
    }

    lastHoveredWaypointIdRef.current = waypointId

    if (pendingTableHoverScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingTableHoverScrollFrameRef.current)
    }

    pendingTableHoverScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingTableHoverScrollFrameRef.current = null

      const tableShell = routeTableShellRef.current
      if (!tableShell) {
        return
      }

      const tableRow = tableShell.querySelector(`tr[data-waypoint-id="${CSS.escape(waypointId)}"]`) as HTMLTableRowElement | null
      if (!tableRow) {
        return
      }

      const rowTop = tableRow.offsetTop
      const rowBottom = rowTop + tableRow.offsetHeight
      const scrollTop = tableShell.scrollTop
      const scrollBottom = scrollTop + tableShell.clientHeight

      if (rowTop < scrollTop) {
        tableShell.scrollTop = rowTop
      } else if (rowBottom > scrollBottom) {
        tableShell.scrollTop = rowBottom - tableShell.clientHeight
      }
    })
  }, [])

  const handleUnhoverWaypoint = useCallback(() => {
    lastHoveredWaypointIdRef.current = null
  }, [])

  function handleDownload() {
    if (!state.inputText) return
    const url = URL.createObjectURL(new Blob([state.inputText], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = activeRouteFilename?.split('/').at(-1) ?? 'route.wpt'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    setFileSaveStatus('Download requested. Verify the file was saved; this does not mark the source file as saved.')
  }

  function handleNamingModeChange(mode: typeof state.namingMode) {
    if (mode === 'shared' && state.loadedRoutes.length > 0 &&
        !window.confirm('Enable shared names? Visible waypoints at the same coordinates will use the first loaded route’s name. This can modify multiple routes and can be undone.')) return
    dispatch({ type: 'naming/set-mode', mode })
  }

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">TravelMapping Route Workbench</p>
          <h1>WPT Editor 3</h1>
          <p className="intro-copy">
            Paste TravelMapping waypoint lines, load them into the map, reverse the route,
            inspect parse issues, and export the current state in `.wpt` form.
          </p>
        </div>
        <div className="status-strip" aria-label="Editor summary">
          <div>
            <span className="status-value">{state.waypoints.length}</span>
            <span className="status-label">Waypoints</span>
          </div>
          <div>
            <span className="status-value">{state.issues.length}</span>
            <span className="status-label">Issues</span>
          </div>
        </div>
      </header>

      <section className={`workspace workspace-${state.layout}`}>
        <div className="editor-column">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <h2>Route Source</h2>
                <p>Paste `.wpt` file lines and load them into the route view.</p>
              </div>
            </div>
            <div className="route-source-editor">
              <pre
                ref={routeSourceHighlightRef}
                className="route-source-highlight"
                aria-hidden="true"
              >
                {routeSourceHighlightNodes}
              </pre>
              <textarea
                ref={routeSourceRef}
                className="route-textarea"
                value={state.inputText}
                aria-label="Route source"
                onChange={(event) => dispatch({ type: 'input/set', value: event.target.value, fitToRoute: state.waypoints.length === 0 })}
                onPaste={handleInitialSourcePaste}
                onScroll={handleRouteSourceScroll}
                spellCheck={false}
                placeholder={'+X865456 http://www.openstreetmap.org/?lat=40.034301&lon=116.574318\nSanYuanQiao http://www.openstreetmap.org/?lat=39.959631&lon=116.451463'}
              />
            </div>
            <div className="route-source-toolbar route-source-toolbar-bottom">
              <div className="inline-actions route-source-actions">
                <input
                  ref={folderInputRef}
                  className="folder-picker-input"
                  type="file"
                  accept=".wpt"
                  multiple
                  onChange={handleFolderInputChange}
                />
                <button type="button" onClick={handleAddRoute}>Add Route</button>
                <button type="button" onClick={handleReplaceRoute}>Replace Route</button>
                <button type="button" onClick={handleAddFolder}>Add Folder</button>
                <button type="button" onClick={handleReverseRoute}>Reverse order</button>
                <button type="button" onClick={handleClearRoute}>Clear</button>
                <button type="button" onClick={handleNewSession} disabled={fileOperationRouteIds.size > 0}>New session</button>
                <button type="button" onClick={handleSaveToTab}>Save to Tab</button>
                <button type="button" onClick={handleDownload}>Download</button>
              </div>
            </div>
            <label className="naming-mode-picker">
              Names at shared coordinates
              <select value={state.namingMode} onChange={(event) => handleNamingModeChange(event.target.value === 'shared' ? 'shared' : 'independent')}>
                <option value="shared">Shared names</option>
                <option value="independent">Independent names</option>
              </select>
            </label>
            <p className="naming-mode-help">{state.namingMode === 'shared'
              ? 'Visible waypoints at matching coordinates share a name. Imports use the first loaded name; edits propagate across routes.'
              : 'Each route keeps its own waypoint names. Shared-station dragging still moves matching coordinates together.'}</p>
            {!state.activeRouteId && state.inputText ? <p>{state.draftBaseline === null
              ? 'New route source'
              : state.inputText === state.draftBaseline ? 'Unmodified pasted source' : 'Modified pasted source'} · not saved locally</p> : null}
            {fileSaveStatus ? <p className="route-source-status" role="status">{fileSaveStatus}</p> : null}
          </article>
          {state.loadedRoutes.length > 0 ? (
            <article className="panel panel-condensed">
              <div className="panel-heading compact">
                <div>
                  <h2>Loaded Routes</h2>
                  <p>{`${state.loadedRoutes.length} route files in memory`}</p>
                </div>
              </div>
              <ul className="loaded-routes-list">
                {state.loadedRoutes.map((route) => {
                  const isActive = route.id === state.activeRouteId
                  return (
                    <li key={route.id}>
                      <div className={`loaded-route-item ${isActive ? 'loaded-route-item-active' : ''}`.trim()}>
                        <button
                          type="button"
                          className="loaded-route-select"
                          onClick={() => handleSetActiveRoute(route.id)}
                        >
                          <span>{route.filename} ({isRouteModified(route) ? 'modified' : 'unmodified'})</span>
                          <span>{`${route.waypoints.length} wp · ${route.issues.length} issues`}{isRouteDirty(state, savedSources, route.id)
                            ? savedSources[route.id] ? ' · changes not saved locally' : ' · not saved locally'
                            : ' · saved locally'}</span>
                        </button>
                        <button
                          type="button"
                          className="loaded-route-copy"
                          onClick={() => handleRefreshRoute(route.id)}
                          title="Refresh route from linked file"
                          aria-label={`Refresh route ${route.filename} from file`}
                          disabled={fileOperationRouteIds.has(route.id)}
                        >
                          &#8635;
                        </button>
                        <button
                          type="button"
                          className="loaded-route-copy loaded-route-rename"
                          onClick={() => handleRenameRoute(route.id)}
                          title="Rename route"
                          aria-label={`Rename route ${route.filename}`}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="loaded-route-copy loaded-route-save"
                          onClick={() => handleSaveRouteToFile(route.id)}
                          title="Save route to file"
                          aria-label={`Save route ${route.filename} to file`}
                          disabled={fileOperationRouteIds.has(route.id) || !canSaveRouteToFile()}
                        >
                          💾
                        </button>
                        <button
                          type="button"
                          className="loaded-route-copy loaded-route-remove"
                          onClick={() => handleRemoveRoute(route.id)}
                          title="Remove route"
                          aria-label={`Remove route ${route.filename}`}
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </article>
          ) : null}
        </div>

        <div className="map-column">
          <article
            ref={mapWrapperRef}
            className="panel map-wrapper"
            style={mapWrapperHeight ? { height: `${mapWrapperHeight}px` } : undefined}
          >
            <div className="panel-heading compact">
              <div>
                <h2>Route Map</h2>
                <p>Current vertical slice: route rendering, fit-to-route, and table-driven editing.</p>
              </div>
              <div className="inline-actions">
                <button type="button" onClick={handleUndo} disabled={state.history.length === 0}>Undo</button>
              </div>
            </div>
            <RouteMap
              waypoints={state.waypoints}
              activeRouteFilename={activeRouteFilename}
              backgroundRoutes={backgroundRoutes}
              fitRequest={state.fitRequest}
              focusWaypointId={focusedWaypointId}
              focusRequest={focusRequest}
              lineWeight={lineWeight}
              issues={state.issues}
              inUseLabels={state.loadedLabelSet}
              onSelectRoute={handleSetActiveRoute}
              onInsertWaypoint={handleMapInsert}
              onRenameWaypoint={handleRenameWaypoint}
              onMatchSharedName={handleMatchSharedName}
              onSetAltLabels={handleSetAltLabels}
              onToggleWaypointKind={handleToggleWaypointKind}
              onDeleteWaypoint={handleDeleteWaypoint}
              onMoveWaypointPosition={handleMoveWaypointPosition}
              onMoveSharedStationPosition={handleMoveSharedStationPosition}
              onSelectWaypoint={handleSelectWaypoint}
              onReuseBackgroundStation={handleReuseBackgroundStation}
              onMergeBackgroundStation={handleMergeBackgroundStation}
              onHoverWaypoint={handleHoverWaypoint}
              onUnhoverWaypoint={handleUnhoverWaypoint}
            />
          </article>

          <div className="details-column">
          <RouteTable waypoints={state.waypoints} issues={state.issues} shellRef={routeTableShellRef}
            onFocus={handleFocusWaypoint} onHoverLine={scrollRouteSourceToLine}
            onMove={handleMoveWaypoint} onDelete={handleDeleteWaypoint} />

          <article className="panel panel-condensed">
            <div className="panel-heading compact">
              <div>
                <h2>Validation</h2>
                <p>Strict parser feedback for malformed waypoint lines.</p>
              </div>
            </div>
            {state.issues.length === 0 ? (
              <p className="empty-state">No parser issues detected.</p>
            ) : (
              <ul className="issue-list">
                {state.issues.map((issue) => (
                  <li key={`${issue.lineNumber}-${issue.message}`}>
                    <strong>Line {issue.lineNumber}.</strong> {issue.message}
                    <span>{issue.content}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
          </div>
        </div>
      </section>
    </main>
  )
}

export default function App() {
  const [sessionKey, setSessionKey] = useState(0)
  return <EditorApp key={sessionKey} onNewSession={() => setSessionKey((key) => key + 1)} />
}
