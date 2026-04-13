import { useMemo, useReducer, useRef, useState, startTransition, type ClipboardEvent } from 'react'
import './App.css'
import { editorReducer, initialEditorState } from './editor/editorReducer'
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

function App() {
  const [state, dispatch] = useReducer(editorReducer, initialEditorState)
  const [draggedWaypointId, setDraggedWaypointId] = useState<string | null>(null)
  const [focusedWaypointId, setFocusedWaypointId] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [distanceUnit, setDistanceUnit] = useState<'mi' | 'km'>('mi')
  const routeSourceRef = useRef<HTMLTextAreaElement | null>(null)

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

  function handleLoad(fitToRoute: boolean) {
    startTransition(() => {
      dispatch({ type: 'route/load', fitToRoute, route: parseWpt(state.inputText) })
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

  function handleMapInsert(hidden: boolean, lat: number, lon: number) {
    startTransition(() => {
      dispatch({ type: 'route/insert', hidden, lat, lon })
    })
  }

  function handleRenameWaypoint(waypointId: string, nextLabel: string) {
    dispatch({ type: 'route/rename-waypoint', waypointId, nextLabel })
  }

  function handleSetAltLabels(waypointId: string, altLabels: string[]) {
    dispatch({ type: 'route/set-alt-labels', waypointId, altLabels })
  }

  function handleToggleWaypointKind(waypointId: string) {
    startTransition(() => {
      dispatch({ type: 'route/toggle-waypoint-kind', waypointId })
    })
  }

  function handleDeleteWaypoint(waypointId: string) {
    startTransition(() => {
      dispatch({ type: 'route/delete-waypoint', waypointId })
    })
  }

  function handleMoveWaypoint(fromIndex: number, toIndex: number) {
    startTransition(() => {
      dispatch({ type: 'route/move-waypoint', fromIndex, toIndex })
    })
  }

  function handleMoveWaypointPosition(waypointId: string, lat: number, lon: number) {
    startTransition(() => {
      dispatch({ type: 'route/update-waypoint-position', waypointId, lat, lon })
    })
  }

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

  function handleSelectWaypoint(waypointId: string) {
    setFocusedWaypointId(waypointId)
  }

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
            <textarea
              ref={routeSourceRef}
              className="route-textarea"
              value={state.inputText}
              onChange={(event) => dispatch({ type: 'input/set', value: event.target.value })}
              onPaste={handleRouteSourcePaste}
              spellCheck={false}
              placeholder={'+X865456 http://www.openstreetmap.org/?lat=40.034301&lon=116.574318\nSanYuanQiao http://www.openstreetmap.org/?lat=39.959631&lon=116.451463'}
            />
            <div className="route-source-toolbar route-source-toolbar-bottom">
              <div className="inline-actions route-source-actions">
                <button type="button" onClick={() => handleLoad(false)}>Load</button>
                <button type="button" onClick={() => handleLoad(true)}>Load and Pan</button>
                <button type="button" onClick={handleReverseRoute}>Reverse order</button>
                <button type="button" onClick={handleClearRoute}>Clear</button>
                <button type="button" onClick={handleSaveToTab}>Save to Tab</button>
              </div>
            </div>
          </article>
        </div>

        <div className="map-column">
          <article className="panel map-wrapper">
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
              onSelectWaypoint={handleSelectWaypoint}
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
              <div className="route-table-shell">
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
                        className={`${row.hidden ? 'route-row-hidden' : ''} ${row.issues.length > 0 ? 'route-row-has-issues' : ''} ${draggedWaypointId === row.id ? 'route-row-dragging' : ''}`.trim()}
                        draggable
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
