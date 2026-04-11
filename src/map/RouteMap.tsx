import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { CircleMarker as LeafletCircleMarker, LatLngBounds, divIcon } from 'leaflet'
import type { ParseIssue, Waypoint } from '../editor/editorTypes'
import { exportWaypointLine } from '../wpt/exportWpt'

type RouteMapProps = {
  waypoints: Waypoint[]
  fitRequest: number
  focusWaypointId: string | null
  focusRequest: number
  lineWeight: number
  issues: ParseIssue[]
  inUseLabels: string[]
  onInsertWaypoint: (hidden: boolean, lat: number, lon: number) => void
  onRenameWaypoint: (waypointId: string, nextLabel: string) => void
  onSetAltLabels: (waypointId: string, altLabels: string[]) => void
  onToggleWaypointKind: (waypointId: string) => void
  onDeleteWaypoint: (waypointId: string) => void
  onMoveWaypointPosition: (waypointId: string, lat: number, lon: number) => void
  onSelectWaypoint: (waypointId: string) => void
}

type DraggingWaypoint = {
  waypointId: string
  lat: number
  lon: number
}

const warningIcon = divIcon({
  className: 'map-warning-icon-shell',
  html: '<div class="map-warning-icon">&#9888;</div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

type MercatorPoint = {
  x: number
  y: number
}

function convertLLToMercXY(waypoint: Waypoint): MercatorPoint {
  return {
    x: waypoint.lon / 360 + 0.5,
    y: 0.5 * Math.log(Math.tan(Math.PI / 4 - (Math.PI / 360) * waypoint.lat)) / Math.PI + 0.5,
  }
}

function convertMercXYToLL(point: MercatorPoint): [number, number] {
  return [
    (360 / Math.PI) * (Math.PI / 4 - Math.atan(Math.exp(2 * Math.PI * (point.y - 0.5)))),
    360 * (point.x - 0.5),
  ]
}

function calcHighlightLines(waypoints: Waypoint[], pixelThickness: number) {
  const hi: [number, number][] = []
  const lo: [number, number][] = []

  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const point1 = convertLLToMercXY(waypoints[index])
    const point2 = convertLLToMercXY(waypoints[index + 1])
    const theta = Math.PI - Math.atan2(point2.y - point1.y, point2.x - point1.x)
    const offset = pixelThickness / (256 * Math.pow(2, 12))

    const hiPoint1 = convertMercXYToLL({
      x: point1.x - offset * Math.sin(theta),
      y: point1.y - offset * Math.cos(theta),
    })
    const hiPoint2 = convertMercXYToLL({
      x: point2.x - offset * Math.sin(theta),
      y: point2.y - offset * Math.cos(theta),
    })
    const loPoint1 = convertMercXYToLL({
      x: point1.x + offset * Math.sin(theta),
      y: point1.y + offset * Math.cos(theta),
    })
    const loPoint2 = convertMercXYToLL({
      x: point2.x + offset * Math.sin(theta),
      y: point2.y + offset * Math.cos(theta),
    })

    hi.push(hiPoint1, hiPoint2)
    lo.push(loPoint1, loPoint2)
  }

  return { hi, lo }
}

function FitToRoute({ fitRequest, waypoints }: Pick<RouteMapProps, 'fitRequest' | 'waypoints'>) {
  const map = useMap()
  const lastAppliedFitRequest = useRef(0)

  useEffect(() => {
    if (fitRequest === 0 || fitRequest === lastAppliedFitRequest.current || waypoints.length === 0) {
      return
    }

    lastAppliedFitRequest.current = fitRequest
    map.invalidateSize()

    if (waypoints.length === 1) {
      map.setView([waypoints[0].lat, waypoints[0].lon], 14)
      return
    }

    const bounds = new LatLngBounds(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon]))
    map.fitBounds(bounds, { padding: [24, 24] })
  }, [fitRequest, map, waypoints])

  return null
}

function FocusWaypoint({
  focusWaypointId,
  focusRequest,
  waypoints,
}: Pick<RouteMapProps, 'focusWaypointId' | 'focusRequest' | 'waypoints'>) {
  const map = useMap()
  const lastAppliedFocusRequest = useRef(0)

  useEffect(() => {
    if (focusRequest === 0 || focusRequest === lastAppliedFocusRequest.current || !focusWaypointId) {
      return
    }

    const waypoint = waypoints.find((candidate) => candidate.id === focusWaypointId)
    if (!waypoint) {
      return
    }

    lastAppliedFocusRequest.current = focusRequest
    map.invalidateSize()
    map.setView([waypoint.lat, waypoint.lon], Math.max(map.getZoom(), 16), {
      animate: true,
    })
  }, [focusRequest, focusWaypointId, map, waypoints])

  return null
}

function SyncMapSize() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const invalidate = () => map.invalidateSize(false)

    invalidate()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', invalidate)
      return () => window.removeEventListener('resize', invalidate)
    }

    const observer = new ResizeObserver(() => {
      invalidate()
    })

    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [map])

  return null
}

function MapInsertionHandler({
  onInsertWaypoint,
  onInsertStationAndEdit,
  isDraggingWaypoint,
  suppressExternalClickUntil,
}: {
  onInsertWaypoint: RouteMapProps['onInsertWaypoint']
  onInsertStationAndEdit: (lat: number, lon: number) => void
  isDraggingWaypoint: boolean
  suppressExternalClickUntil: number
}) {
  const map = useMap()
  const clickTimer = useRef<number | null>(null)
  const suppressClickUntil = useRef(0)
  const popupOpen = useRef(false)

  useMapEvents({
    popupopen() {
      popupOpen.current = true
    },
    popupclose() {
      popupOpen.current = false
    },
    click(event) {
      if (
        isDraggingWaypoint ||
        event.originalEvent.detail > 1 ||
        performance.now() < Math.max(suppressClickUntil.current, suppressExternalClickUntil)
      ) {
        return
      }

      const target = event.originalEvent.target as Element | null
      if (target?.closest('.leaflet-popup')) {
        return
      }

      if (popupOpen.current) {
        if (clickTimer.current !== null) {
          window.clearTimeout(clickTimer.current)
          clickTimer.current = null
        }

        popupOpen.current = false
        map.closePopup()
        return
      }

      if (clickTimer.current !== null) {
        window.clearTimeout(clickTimer.current)
      }

      clickTimer.current = window.setTimeout(() => {
        onInsertWaypoint(true, event.latlng.lat, event.latlng.lng)
        clickTimer.current = null
      }, 220)
    },
    dblclick(event) {
      if (isDraggingWaypoint) {
        return
      }

      suppressClickUntil.current = performance.now() + 300

      if (clickTimer.current !== null) {
        window.clearTimeout(clickTimer.current)
        clickTimer.current = null
      }

      if (popupOpen.current) {
        popupOpen.current = false
        map.closePopup()
        return
      }

      onInsertStationAndEdit(event.latlng.lat, event.latlng.lng)
    },
  })

  useEffect(
    () => () => {
      if (clickTimer.current !== null) {
        window.clearTimeout(clickTimer.current)
      }
    },
    [],
  )

  return null
}

function WaypointDragHandler({
  draggingWaypoint,
  onPreviewWaypoint,
  onCommitWaypoint,
}: {
  draggingWaypoint: DraggingWaypoint | null
  onPreviewWaypoint: (lat: number, lon: number) => void
  onCommitWaypoint: (lat: number, lon: number) => void
}) {
  const map = useMap()

  useEffect(() => {
    if (!draggingWaypoint) {
      map.dragging.enable()
      map.doubleClickZoom.enable()
      return
    }

    map.dragging.disable()
    map.doubleClickZoom.disable()

    return () => {
      map.dragging.enable()
      map.doubleClickZoom.enable()
    }
  }, [draggingWaypoint, map])

  useMapEvents({
    mousemove(event) {
      if (!draggingWaypoint) {
        return
      }

      onPreviewWaypoint(event.latlng.lat, event.latlng.lng)
    },
    mouseup(event) {
      if (!draggingWaypoint) {
        return
      }

      onCommitWaypoint(event.latlng.lat, event.latlng.lng)
    },
  })

  return null
}

function WaypointPopupContent({
  waypoint,
  onRenameWaypoint,
  onSetAltLabels,
  onToggleWaypointKind,
  onDeleteWaypoint,
  onPopupInteractionStart,
  issueCodes,
}: Pick<RouteMapProps, 'onRenameWaypoint' | 'onSetAltLabels' | 'onToggleWaypointKind' | 'onDeleteWaypoint'> & {
  waypoint: Waypoint
  onPopupInteractionStart: () => void
  issueCodes: string[]
}) {
  const map = useMap()
  const stationInputRef = useRef<HTMLInputElement | null>(null)
  const [draftLabel, setDraftLabel] = useState(waypoint.label)
  const [draftAltLabels, setDraftAltLabels] = useState(waypoint.altLabels.join(' '))
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')
  const [pendingStationFocus, setPendingStationFocus] = useState(false)

  const waypointLine = useMemo(() => exportWaypointLine(waypoint), [waypoint])

  useEffect(() => {
    setDraftLabel(waypoint.label)
  }, [waypoint.label])

  useEffect(() => {
    setDraftAltLabels(waypoint.altLabels.join(' '))
  }, [waypoint.altLabels])

  useEffect(() => {
    setCopyStatus('idle')
  }, [waypointLine])

  useEffect(() => {
    if (!pendingStationFocus || waypoint.hidden) {
      return
    }

    stationInputRef.current?.focus()
    stationInputRef.current?.select()
    setPendingStationFocus(false)
  }, [pendingStationFocus, waypoint.hidden])

  useEffect(() => {
    const nextLabel = draftLabel.trim()
    if (!nextLabel || nextLabel === waypoint.label) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      onRenameWaypoint(waypoint.id, nextLabel)
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [draftLabel, onRenameWaypoint, waypoint.id, waypoint.label])

  useEffect(() => {
    const nextAltLabels = draftAltLabels
      .split(/\s+/)
      .map((label) => label.trim())
      .filter(Boolean)

    if (nextAltLabels.join(' ') === waypoint.altLabels.join(' ')) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      onSetAltLabels(waypoint.id, nextAltLabels)
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [draftAltLabels, onSetAltLabels, waypoint.altLabels, waypoint.id])

  async function handleCopyWaypointLine() {
    try {
      await navigator.clipboard.writeText(waypointLine)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('idle')
    }
  }

  function stopEventPropagation(event: { stopPropagation: () => void }) {
    event.stopPropagation()
  }

  function handlePopupInteractionStart() {
    onPopupInteractionStart()
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    map.closePopup()
  }

  return (
    <div
      className="waypoint-popup"
      onMouseDownCapture={handlePopupInteractionStart}
      onTouchStartCapture={handlePopupInteractionStart}
      onClick={stopEventPropagation}
      onDoubleClick={stopEventPropagation}
      onMouseDown={stopEventPropagation}
    >
      <div className="waypoint-popup-subheader">{waypoint.hidden ? 'Geometry node' : 'Station'}</div>
      <div className="waypoint-popup-title-row">
        <input
          ref={stationInputRef}
          className="waypoint-popup-title-input"
          type="text"
          value={draftLabel}
          autoFocus
          onChange={(event) => setDraftLabel(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={handleInputKeyDown}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        />
      </div>
      {issueCodes.length > 0 ? <div className="waypoint-popup-issues">{issueCodes.join(' · ')}</div> : null}
      <label className="waypoint-popup-field">
        <span>Alt labels</span>
        <input
          className="waypoint-popup-field-input"
          type="text"
          value={draftAltLabels}
          placeholder="Alt labels separated by spaces"
          onChange={(event) => setDraftAltLabels(event.target.value)}
          onKeyDown={handleInputKeyDown}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        />
      </label>
      <p>{`${waypoint.lat.toFixed(6)}, ${waypoint.lon.toFixed(6)}`}</p>
      <div className="waypoint-popup-action-row">
        <button
          type="button"
          className="waypoint-copy-button waypoint-convert-button"
          onMouseDown={stopEventPropagation}
          onClick={() => {
            if (waypoint.hidden) {
              setPendingStationFocus(true)
            }
            onToggleWaypointKind(waypoint.id)
          }}
        >
          {waypoint.hidden ? 'Convert to Station' : 'Convert to Geometry Node'}
        </button>
        <button
          type="button"
          className="waypoint-copy-button"
          aria-label="Delete waypoint"
          title="Delete waypoint"
          onMouseDown={stopEventPropagation}
          onClick={() => onDeleteWaypoint(waypoint.id)}
        >
          🗑
        </button>
        <button
          type="button"
          className="waypoint-copy-button"
          aria-label="Copy waypoint line"
          title="Copy waypoint line"
          onMouseDown={stopEventPropagation}
          onClick={handleCopyWaypointLine}
        >
          🔗
        </button>
      </div>
      {copyStatus === 'copied' ? <span className="waypoint-copy-status">Copied</span> : null}
    </div>
  )
}

export function RouteMap({
  waypoints,
  fitRequest,
  focusWaypointId,
  focusRequest,
  lineWeight,
  issues,
  inUseLabels,
  onInsertWaypoint,
  onRenameWaypoint,
  onSetAltLabels,
  onToggleWaypointKind,
  onDeleteWaypoint,
  onMoveWaypointPosition,
  onSelectWaypoint,
}: RouteMapProps) {
  const [draggingWaypoint, setDraggingWaypoint] = useState<DraggingWaypoint | null>(null)
  const [suppressExternalClickUntil, setSuppressExternalClickUntil] = useState(0)
  const [pendingPopupWaypointId, setPendingPopupWaypointId] = useState<string | null>(null)
  const markerRefs = useRef(new Map<string, LeafletCircleMarker>())
  const pendingInsertedStationWaypointIds = useRef<Set<string> | null>(null)

  function handleInsertStationAndEdit(lat: number, lon: number) {
    pendingInsertedStationWaypointIds.current = new Set(waypoints.map((waypoint) => waypoint.id))
    onInsertWaypoint(false, lat, lon)
  }

  function handlePopupInteractionStart() {
    setSuppressExternalClickUntil(performance.now() + 500)
  }

  useEffect(() => {
    if (!pendingInsertedStationWaypointIds.current) {
      return
    }

    const insertedWaypoint = waypoints.find(
      (waypoint) =>
        !pendingInsertedStationWaypointIds.current?.has(waypoint.id) &&
        waypoint.hidden === false,
    )

    if (!insertedWaypoint) {
      return
    }

    pendingInsertedStationWaypointIds.current = null
    onSelectWaypoint(insertedWaypoint.id)
    setPendingPopupWaypointId(insertedWaypoint.id)
  }, [onSelectWaypoint, waypoints])

  useEffect(() => {
    if (!pendingPopupWaypointId) {
      return
    }

    const marker = markerRefs.current.get(pendingPopupWaypointId)
    if (!marker) {
      return
    }

    marker.openPopup()
    setPendingPopupWaypointId(null)
  }, [pendingPopupWaypointId, waypoints])

  const positions = useMemo(
    () =>
      waypoints.map((waypoint) => {
        if (draggingWaypoint?.waypointId === waypoint.id) {
          return [draggingWaypoint.lat, draggingWaypoint.lon] as [number, number]
        }

        return [waypoint.lat, waypoint.lon] as [number, number]
      }),
    [draggingWaypoint, waypoints],
  )

  const renderedWaypoints = useMemo(
    () =>
      waypoints.map((waypoint) =>
        draggingWaypoint?.waypointId === waypoint.id
          ? {
              ...waypoint,
              lat: draggingWaypoint.lat,
              lon: draggingWaypoint.lon,
            }
          : waypoint,
      ),
    [draggingWaypoint, waypoints],
  )

  const inUseLabelSet = useMemo(() => new Set(inUseLabels), [inUseLabels])
  const issueMap = useMemo(() => {
    const nextMap = new Map<number, string[]>()

    for (const issue of issues) {
      const codes = nextMap.get(issue.lineNumber) ?? []
      if (!codes.includes(issue.message)) {
        codes.push(issue.message)
      }
      nextMap.set(issue.lineNumber, codes)
    }

    return nextMap
  }, [issues])
  const thicknessMultiplier = lineWeight / 4
  const highlightLines = useMemo(
    () => calcHighlightLines(renderedWaypoints, 20 * thicknessMultiplier),
    [renderedWaypoints, thicknessMultiplier],
  )
  const corridorPolygon = useMemo(
    () => [...highlightLines.hi, ...[...highlightLines.lo].reverse()],
    [highlightLines.hi, highlightLines.lo],
  )

  return (
    <div className="map-panel">
      <MapContainer center={[39.9, 116.4]} zoom={6} scrollWheelZoom doubleClickZoom={false} className="map-canvas">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <SyncMapSize />
        <FitToRoute fitRequest={fitRequest} waypoints={waypoints} />
        <FocusWaypoint focusWaypointId={focusWaypointId} focusRequest={focusRequest} waypoints={waypoints} />
        <MapInsertionHandler
          onInsertWaypoint={onInsertWaypoint}
          onInsertStationAndEdit={handleInsertStationAndEdit}
          isDraggingWaypoint={draggingWaypoint !== null}
          suppressExternalClickUntil={suppressExternalClickUntil}
        />
        <WaypointDragHandler
          draggingWaypoint={draggingWaypoint}
          onPreviewWaypoint={(lat, lon) => {
            setDraggingWaypoint((current) =>
              current
                ? {
                    ...current,
                    lat,
                    lon,
                  }
                : null,
            )
          }}
          onCommitWaypoint={(lat, lon) => {
            if (!draggingWaypoint) {
              return
            }

            onMoveWaypointPosition(draggingWaypoint.waypointId, lat, lon)
            setDraggingWaypoint(null)
            setSuppressExternalClickUntil(performance.now() + 250)
          }}
        />
        {positions.length > 1 ? (
          <>
            <Polygon
              positions={corridorPolygon}
              pathOptions={{
                stroke: false,
                fillColor: '#ff6b5f',
                fillOpacity: 0.26,
                fillRule: 'nonzero',
              }}
            />
            <Polyline
              positions={positions}
              pathOptions={{
                color: '#1769ff',
                weight: 7 * thicknessMultiplier,
                opacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </>
        ) : null}
        {renderedWaypoints.map((waypoint, index) => {
          const isInUse = inUseLabelSet.has(waypoint.label)
          const issueCodes = issueMap.get(index + 1) ?? []
          const stationRadius = waypoint.hidden ? 5 : Math.max(7, Math.min(14, lineWeight + 3))

          return (
            <>
              <CircleMarker
                key={waypoint.id}
                ref={(marker) => {
                  if (marker) {
                    markerRefs.current.set(waypoint.id, marker)
                    return
                  }

                  markerRefs.current.delete(waypoint.id)
                }}
                center={[waypoint.lat, waypoint.lon]}
                radius={stationRadius}
                bubblingMouseEvents={false}
                eventHandlers={{
                  click: () => {
                    onSelectWaypoint(waypoint.id)
                  },
                  mousedown: (event) => {
                    if (focusWaypointId !== waypoint.id) {
                      return
                    }

                    event.originalEvent.preventDefault()
                    event.originalEvent.stopPropagation()
                    setDraggingWaypoint({
                      waypointId: waypoint.id,
                      lat: waypoint.lat,
                      lon: waypoint.lon,
                    })
                  },
                  ...(waypoint.hidden
                    ? {
                        contextmenu: () => {
                          onDeleteWaypoint(waypoint.id)
                        },
                      }
                    : {}),
                }}
                pathOptions={{
                  color: issueCodes.length > 0 ? '#9f2d1d' : isInUse ? '#144d46' : waypoint.hidden ? '#8f5d12' : '#111827',
                  fillColor: issueCodes.length > 0 ? '#fff1bf' : isInUse ? '#2fa67f' : waypoint.hidden ? '#f1c15a' : '#fff7eb',
                  fillOpacity: 0.98,
                  weight: waypoint.hidden ? 2 : 3,
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                  {`${index + 1}. ${waypoint.label}`}
                </Tooltip>
                <Popup>
                  <WaypointPopupContent
                    waypoint={waypoint}
                    issueCodes={issueCodes}
                    onPopupInteractionStart={handlePopupInteractionStart}
                    onRenameWaypoint={onRenameWaypoint}
                    onSetAltLabels={onSetAltLabels}
                    onToggleWaypointKind={onToggleWaypointKind}
                    onDeleteWaypoint={onDeleteWaypoint}
                  />
                </Popup>
              </CircleMarker>
              {issueCodes.length > 0 ? (
                <Marker
                  key={`${waypoint.id}-warning`}
                  position={[waypoint.lat, waypoint.lon]}
                  icon={warningIcon}
                  interactive={false}
                  zIndexOffset={1000}
                />
              ) : null}
            </>
          )
        })}
      </MapContainer>
    </div>
  )
}
