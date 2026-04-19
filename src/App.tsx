import { useCallback, useEffect, useMemo, useReducer, useRef, useState, startTransition, type ChangeEvent, type ClipboardEvent } from 'react'
import './App.css'
import { editorReducer, initialEditorState } from './editor/editorReducer'
import type { LoadedRoute } from './editor/editorTypes'
import { RouteMap } from './map/RouteMap'
import { exportWpt } from './wpt/exportWpt'
import { parseWpt } from './wpt/parseWpt'

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

type FileSystemWritableFileStreamLike = {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
}

type FileSystemFileHandleLike = {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<FileSystemWritableFileStreamLike>
}

type FileSystemDirectoryHandleLike = {
  kind: 'directory'
  name: string
  values: () => AsyncIterable<FileSystemFileHandleLike | FileSystemDirectoryHandleLike>
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>
  showSaveFilePicker?: (options?: {
    suggestedName?: string
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
  }) => Promise<FileSystemFileHandleLike>
}

function buildLoadedRoute(filename: string, inputText: string, index: number): LoadedRoute {
  const parsedRoute = parseWpt(inputText)
  return {
    id: `${filename}-${Date.now()}-${index}`,
    filename,
    inputText,
    waypoints: parsedRoute.waypoints,
    issues: parsedRoute.issues,
  }
}

async function collectWptFileHandles(
  directoryHandle: FileSystemDirectoryHandleLike,
  prefix = '',
): Promise<Array<{ relativePath: string; handle: FileSystemFileHandleLike }>> {
  const routes: Array<{ relativePath: string; handle: FileSystemFileHandleLike }> = []

  for await (const entry of directoryHandle.values()) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.wpt')) {
      routes.push({
        relativePath: prefix ? `${prefix}/${entry.name}` : entry.name,
        handle: entry,
      })
      continue
    }

    if (entry.kind === 'directory') {
      routes.push(...(await collectWptFileHandles(entry, prefix ? `${prefix}/${entry.name}` : entry.name)))
    }
  }

  return routes.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function App() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)
  const [draggedWaypointId, setDraggedWaypointId] = useState<string | null>(null)
  const [focusedWaypointId, setFocusedWaypointId] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [distanceUnit, setDistanceUnit] = useState<'mi' | 'km'>('mi')
  const [mapWrapperHeight, setMapWrapperHeight] = useState<number | null>(null)
  const routeSourceRef = useRef<HTMLTextAreaElement | null>(null)
  const routeSourceHighlightRef = useRef<HTMLPreElement | null>(null)
  const routeTableShellRef = useRef<HTMLDivElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const mapWrapperRef = useRef<HTMLElement | null>(null)
  const routeFileHandlesRef = useRef(new Map<string, FileSystemFileHandleLike>())
  const pendingTableHoverScrollFrameRef = useRef<number | null>(null)
  const pendingSourceHoverScrollFrameRef = useRef<number | null>(null)
  const lastHoveredWaypointIdRef = useRef<string | null>(null)
  const lastHoveredRouteRowRef = useRef<number | null>(null)
  const [fileSaveStatus, setFileSaveStatus] = useState<string | null>(null)

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

  const routeRows = useMemo(() => {
    let totalDistance = 0
    const issueMap = new Map<number, string[]>()

    for (const issue of state.issues) {
      const issueCodes = issueMap.get(issue.lineNumber) ?? []
      if (!issueCodes.includes(issue.message)) {
        issueCodes.push(issue.message)
      }
      issueMap.set(issue.lineNumber, issueCodes)
    }

    return state.waypoints.map((waypoint, index) => {
      const segmentDistance =
        index === 0
          ? 0
          : mileage(
              state.waypoints[index - 1].lat,
              state.waypoints[index - 1].lon,
              waypoint.lat,
              waypoint.lon,
            )

      totalDistance += segmentDistance

      return {
        id: waypoint.id,
        index,
        label: waypoint.label,
        altLabels: waypoint.altLabels,
        issues: issueMap.get(index + 1) ?? [],
        hidden: waypoint.hidden,
        lat: waypoint.lat.toFixed(6),
        lon: waypoint.lon.toFixed(6),
        segmentDistanceMiles: segmentDistance,
        totalDistanceMiles: totalDistance,
      }
    })
  }, [state.issues, state.waypoints])

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

  function canSaveRouteToFile(routeId: string) {
    const pickerWindow = window as DirectoryPickerWindow
    return routeFileHandlesRef.current.has(routeId) || typeof pickerWindow.showSaveFilePicker === 'function'
  }

  function handleAddRoute() {
    const inputText = state.inputText.trim()
    if (!inputText) {
      return
    }

    const parsedRoute = parseWpt(state.inputText)
    const routeId = `${nextGeneratedRouteFilename()}-${Date.now()}`

    startTransition(() => {
      dispatch({
        type: 'routes/add-route',
        route: {
          id: routeId,
          filename: routeId.slice(0, routeId.lastIndexOf('-')),
          inputText: state.inputText,
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
    const routeId = activeRoute?.id ?? `${filename}-${Date.now()}`

    startTransition(() => {
      dispatch({
        type: 'routes/replace-active-route',
        route: {
          id: routeId,
          filename,
          inputText: state.inputText,
          waypoints: parsedRoute.waypoints,
          issues: parsedRoute.issues,
        },
      })
    })
  }

  function handleSaveToTab() {
    const text = state.waypoints.length > 0 ? exportWpt(state.waypoints) : state.inputText.trim()

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
      dispatch({ type: 'route/insert', hidden, lat, lon })
    })
  }, [dispatch])

  const handleRenameWaypoint = useCallback((waypointId: string, nextLabel: string) => {
    dispatch({ type: 'route/rename-waypoint', waypointId, nextLabel })
  }, [dispatch])

  const handleSetAltLabels = useCallback((waypointId: string, altLabels: string[]) => {
    dispatch({ type: 'route/set-alt-labels', waypointId, altLabels })
  }, [dispatch])

  const handleToggleWaypointKind = useCallback((waypointId: string) => {
    startTransition(() => {
      dispatch({ type: 'route/toggle-waypoint-kind', waypointId })
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

  function handleRouteSourcePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedText = event.clipboardData.getData('text')

    if (!pastedText) {
      return
    }

    event.preventDefault()

    const textarea = routeSourceRef.current
    const selectionStart = textarea?.selectionStart ?? state.inputText.length
    const selectionEnd = textarea?.selectionEnd ?? state.inputText.length
    const nextInputText =
      state.inputText.slice(0, selectionStart) + pastedText + state.inputText.slice(selectionEnd)
    const fitToRoute = state.waypoints.length === 0

    dispatch({ type: 'input/set', value: nextInputText })
    startTransition(() => {
      dispatch({ type: 'route/load', fitToRoute, route: parseWpt(nextInputText) })
    })
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
    const files = Array.from(event.target.files ?? [])
      .filter((file) => file.name.toLowerCase().endsWith('.wpt'))
      .sort((left, right) => left.name.localeCompare(right.name))

    if (files.length === 0) {
      return
    }

    const routes = await Promise.all(files.map(async (file, index) => buildLoadedRoute(file.name, await file.text(), index + 1)))

    startTransition(() => {
      dispatch({ type: 'routes/add-folder', routes })
    })

    setFileSaveStatus('Added folder via browser file input. Save-back to source files is unavailable for these routes.')
    setFocusedWaypointId(null)
    setFocusRequest(0)
    event.target.value = ''
  }

  async function handleAddFolder() {
    const pickerWindow = window as DirectoryPickerWindow

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
        fileEntries.map(async ({ relativePath, handle }, index) => {
          const route = buildLoadedRoute(relativePath, await (await handle.getFile()).text(), index + 1)
          routeFileHandlesRef.current.set(route.id, handle)
          return route
        }),
      )

      startTransition(() => {
        dispatch({ type: 'routes/add-folder', routes })
      })

      setFileSaveStatus(`Added ${routes.length} file-backed route${routes.length === 1 ? '' : 's'} from folder.`)
      setFocusedWaypointId(null)
      setFocusRequest(0)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      setFileSaveStatus('Unable to open folder for file-backed editing in this browser.')
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

    const hadFileHandle = routeFileHandlesRef.current.has(routeId)
    if (hadFileHandle) {
      routeFileHandlesRef.current.delete(routeId)
      setFileSaveStatus(`Renamed ${route.filename} to ${filename}. Save will use Save As next time.`)
    } else {
      setFileSaveStatus(`Renamed ${route.filename} to ${filename}.`)
    }

    startTransition(() => {
      dispatch({ type: 'routes/rename', routeId, filename })
    })
  }

  function handleRemoveRoute(routeId: string) {
    routeFileHandlesRef.current.delete(routeId)
    startTransition(() => {
      dispatch({ type: 'routes/remove', routeId })
    })
    setFocusedWaypointId(null)
    setFocusRequest((current) => current + 1)
  }

  async function handleSaveRouteToFile(routeId: string) {
    const route = state.loadedRoutes.find((candidate) => candidate.id === routeId)
    let handle = routeFileHandlesRef.current.get(routeId)

    if (!route) {
      setFileSaveStatus('That route could not be found.')
      return
    }

    if (!handle) {
      const pickerWindow = window as DirectoryPickerWindow

      if (typeof pickerWindow.showSaveFilePicker !== 'function') {
        setFileSaveStatus('This browser cannot save that route directly. Use a Chromium-based browser or Save to Tab.')
        return
      }

      try {
        handle = await pickerWindow.showSaveFilePicker({
          suggestedName: route.filename,
          types: [
            {
              description: 'TravelMapping waypoint files',
              accept: { 'text/plain': ['.wpt'] },
            },
          ],
        })
        routeFileHandlesRef.current.set(routeId, handle)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setFileSaveStatus('Unable to open a save dialog for that route.')
        return
      }
    }

    const writable = await handle.createWritable()
    const saveText = routeId === state.activeRouteId ? state.inputText : route.inputText
    await writable.write(saveText)
    await writable.close()

    setFileSaveStatus(`Saved ${route.filename} to disk.`)
  }

  async function handleCopyLoadedRoute(routeId: string) {
    const route = state.loadedRoutes.find((candidate) => candidate.id === routeId)
    if (!route) {
      return
    }

    const text = route.waypoints.length > 0 ? exportWpt(route.waypoints) : route.inputText.trim()
    if (!text) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Ignore clipboard failures silently; browser permission state can block this.
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

      const tableRow = tableShell.querySelector(`tr[data-waypoint-id="${waypointId}"]`) as HTMLTableRowElement | null
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

  function handleHoverRouteRow(rowIndex: number) {
    scrollRouteSourceToLine(rowIndex)
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
                onChange={(event) => dispatch({ type: 'input/set', value: event.target.value })}
                onPaste={handleRouteSourcePaste}
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
                <button type="button" onClick={handleSaveToTab}>Save to Tab</button>
              </div>
            </div>
            {fileSaveStatus ? <p className="route-source-status">{fileSaveStatus}</p> : null}
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
                          <span>{route.filename}</span>
                          <span>{`${route.waypoints.length} wp · ${route.issues.length} issues`}</span>
                        </button>
                        <button
                          type="button"
                          className="loaded-route-copy"
                          onClick={() => handleCopyLoadedRoute(route.id)}
                          title="Copy full route"
                          aria-label={`Copy full route ${route.filename}`}
                        >
                          📎
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
                          disabled={!canSaveRouteToFile(route.id)}
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
                <button type="button" onClick={handleUndo}>Undo</button>
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
              onInsertWaypoint={handleMapInsert}
              onRenameWaypoint={handleRenameWaypoint}
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
          <article className="panel panel-condensed">
            <div className="panel-heading compact">
              <div>
                <h2>Route Table</h2>
                <p>Drag rows to reorder the route, or use the row controls for precise moves.</p>
              </div>
              <div className="inline-actions">
                <div className="distance-toggle" role="group" aria-label="Distance unit">
                  <button
                    type="button"
                    className={distanceUnit === 'mi' ? 'distance-toggle-active' : undefined}
                    onClick={() => setDistanceUnit('mi')}
                  >
                    mi
                  </button>
                  <button
                    type="button"
                    className={distanceUnit === 'km' ? 'distance-toggle-active' : undefined}
                    onClick={() => setDistanceUnit('km')}
                  >
                    km
                  </button>
                </div>
              </div>
            </div>
            {routeRows.length === 0 ? (
              <p className="empty-state">Load a route to inspect and reorder its waypoint table.</p>
            ) : (
              <div ref={routeTableShellRef} className="route-table-shell">
                <table className="route-table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Label</th>
                      <th scope="col">Type</th>
                      <th scope="col">Lat</th>
                      <th scope="col">Lon</th>
                      <th scope="col">Seg. {distanceUnit}</th>
                      <th scope="col">Tot. {distanceUnit}</th>
                      <th scope="col">Move</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeRows.map((row) => (
                      <tr
                        key={row.id}
                        data-waypoint-id={row.id}
                        className={`${row.hidden ? 'route-row-hidden' : ''} ${row.issues.length > 0 ? 'route-row-has-issues' : ''} ${draggedWaypointId === row.id ? 'route-row-dragging' : ''}`.trim()}
                        draggable
                        onMouseEnter={() => handleHoverRouteRow(row.index)}
                        onClick={() => handleFocusWaypoint(row.id)}
                        onDragStart={() => setDraggedWaypointId(row.id)}
                        onDragEnd={() => setDraggedWaypointId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (!draggedWaypointId) {
                            return
                          }

                          const fromIndex = routeRows.findIndex((candidate) => candidate.id === draggedWaypointId)
                          if (fromIndex >= 0) {
                            handleMoveWaypoint(fromIndex, row.index)
                          }
                          setDraggedWaypointId(null)
                        }}
                      >
                        <td>{row.index + 1}</td>
                        <td className="route-row-label-cell">
                          <div>{row.label}</div>
                          {row.altLabels.length > 0 ? (
                            <div className="route-row-alt-labels">{row.altLabels.join(' ')}</div>
                          ) : null}
                          {row.issues.length > 0 ? (
                            <div className="route-row-issues">{row.issues.join(' · ')}</div>
                          ) : null}
                        </td>
                        <td>{row.hidden ? 'Geo' : 'Station'}</td>
                        <td>{row.lat}</td>
                        <td>{row.lon}</td>
                        <td>{(distanceUnit === 'km' ? row.segmentDistanceMiles * 1.609344 : row.segmentDistanceMiles).toFixed(2)}</td>
                        <td>{(distanceUnit === 'km' ? row.totalDistanceMiles * 1.609344 : row.totalDistanceMiles).toFixed(2)}</td>
                        <td>
                          <div className="route-row-move-actions">
                            <button
                              type="button"
                              className="route-row-move-button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleMoveWaypoint(row.index, Math.max(0, row.index - 1))
                              }}
                              disabled={row.index === 0}
                              aria-label={`Move ${row.label} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="route-row-move-button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleMoveWaypoint(row.index, Math.min(routeRows.length - 1, row.index + 1))
                              }}
                              disabled={row.index === routeRows.length - 1}
                              aria-label={`Move ${row.label} down`}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="route-row-move-button route-row-remove-button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleDeleteWaypoint(row.id)
                              }}
                              aria-label={`Remove ${row.label}`}
                            >
                              🗑
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

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

export default App
