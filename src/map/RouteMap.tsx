import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { CircleMarker as LeafletCircleMarker, LatLngBounds, divIcon } from 'leaflet'
import type { ParseIssue, Waypoint } from '../editor/editorTypes'
import { exportWaypointLine } from '../wpt/exportWpt'

type RouteMapProps = {
  waypoints: Waypoint[]
  activeRouteFilename: string | null
  backgroundRoutes: {
    id: string
    filename: string
    waypoints: Waypoint[]
  }[]
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
  onMoveSharedStationPosition: (sourceLat: number, sourceLon: number, lat: number, lon: number) => void
  onSelectWaypoint: (waypointId: string) => void
  onReuseBackgroundStation: (label: string, altLabels: string[], lat: number, lon: number, hidden: boolean) => void
  onMergeBackgroundStation: (deleteWaypointId: string, label: string, altLabels: string[], lat: number, lon: number) => void
  onHoverWaypoint: (waypointId: string) => void
  onUnhoverWaypoint: () => void
}

type DraggingWaypoint = {
  waypointId: string
  lat: number
  lon: number
}

type DraggingSharedStation = {
  sourceLat: number
  sourceLon: number
  lat: number
  lon: number
}

type DraggingTarget =
  | { kind: 'waypoint'; payload: DraggingWaypoint }
  | { kind: 'shared-station'; payload: DraggingSharedStation }

type BackgroundStationMember = {
  routeId: string
  routeFilename: string
  waypoint: Waypoint
  isActive: boolean
}

type BackgroundStationGroup = {
  key: string
  lat: number
  lon: number
  members: BackgroundStationMember[]
}

const backgroundRouteColors = ['#6b7280', '#4b5563', '#7c868f', '#5b6470']

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

function toCoordinateKey(lat: number, lon: number) {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

function sameCoordinate(lat1: number, lon1: number, lat2: number, lon2: number) {
  return toCoordinateKey(lat1, lon1) === toCoordinateKey(lat2, lon2)
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

function sampleWaypointsForCorridor(waypoints: Waypoint[], targetPointCount: number) {
  if (waypoints.length <= targetPointCount) {
    return waypoints
  }

  const stride = Math.max(2, Math.ceil(waypoints.length / targetPointCount))
  const sampled: Waypoint[] = [waypoints[0]]

  for (let index = stride; index < waypoints.length - 1; index += stride) {
    sampled.push(waypoints[index])
  }

  const lastWaypoint = waypoints.at(-1)
  if (lastWaypoint && sampled.at(-1)?.id !== lastWaypoint.id) {
    sampled.push(lastWaypoint)
  }

  return sampled
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
  isDragging,
  onPreviewWaypoint,
  onCommitWaypoint,
}: {
  isDragging: boolean
  onPreviewWaypoint: (lat: number, lon: number) => void
  onCommitWaypoint: (lat: number, lon: number) => void
}) {
  const map = useMap()

  useEffect(() => {
    if (!isDragging) {
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
  }, [isDragging, map])

  useMapEvents({
    mousemove(event) {
      if (!isDragging) {
        return
      }

      onPreviewWaypoint(event.latlng.lat, event.latlng.lng)
    },
    mouseup(event) {
      if (!isDragging) {
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
  issueCodes,
}: Pick<RouteMapProps, 'onRenameWaypoint' | 'onSetAltLabels' | 'onToggleWaypointKind' | 'onDeleteWaypoint'> & {
  waypoint: Waypoint
  issueCodes: string[]
}) {
  const map = useMap()
  const [draftLabel, setDraftLabel] = useState(waypoint.label)
  const [draftAltLabels, setDraftAltLabels] = useState(waypoint.altLabels.join(' '))
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')

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

  function commitLabel() {
    const nextLabel = draftLabel.trim()
    if (!nextLabel || nextLabel === waypoint.label) {
      return
    }

    onRenameWaypoint(waypoint.id, nextLabel)
  }

  function commitAltLabels() {
    const nextAltLabels = draftAltLabels
      .split(/\s+/)
      .map((label) => label.trim())
      .filter(Boolean)

    if (nextAltLabels.join(' ') === waypoint.altLabels.join(' ')) {
      return
    }

    onSetAltLabels(waypoint.id, nextAltLabels)
  }

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

  function handleLabelKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    commitLabel()
    map.closePopup()
  }

  function handleAltLabelsKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    commitAltLabels()
    map.closePopup()
  }

  return (
    <div
      className="waypoint-popup"
      onClick={stopEventPropagation}
      onDoubleClick={stopEventPropagation}
      onMouseDown={stopEventPropagation}
    >
      <div className="waypoint-popup-subheader">{waypoint.hidden ? 'Geometry node' : 'Station'}</div>
      <div className="waypoint-popup-title-row">
        <input
          className="waypoint-popup-title-input"
          type="text"
          value={draftLabel}
          autoFocus
          onChange={(event) => setDraftLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={handleLabelKeyDown}
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
          onBlur={commitAltLabels}
          onKeyDown={handleAltLabelsKeyDown}
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
          onClick={() => onToggleWaypointKind(waypoint.id)}
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

function BackgroundStationPopupContent({
  group,
  waypoints,
  onReuseBackgroundStation,
  onMergeBackgroundStation,
}: {
  group: BackgroundStationGroup
  waypoints: Waypoint[]
  onReuseBackgroundStation: RouteMapProps['onReuseBackgroundStation']
  onMergeBackgroundStation: RouteMapProps['onMergeBackgroundStation']
}) {
  const activeMembers = group.members.filter((member) => member.isActive)
  const backgroundMembers = group.members.filter((member) => !member.isActive)

  // Calculate nearest active station to suggest merge with each background station
  const getNearestActiveStation = (bgLat: number, bgLon: number) => {
    if (waypoints.length === 0) return null

    let nearest = { waypoint: waypoints[0], distance: Infinity, index: 0 }

    for (let index = 0; index < waypoints.length; index += 1) {
      const wp = waypoints[index]
      if (wp.hidden) continue

      const latDiff = wp.lat - bgLat
      const lonDiff = wp.lon - bgLon
      const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff)

      if (distance < nearest.distance) {
        nearest = { waypoint: wp, distance, index }
      }
    }

    return nearest.distance < Infinity ? nearest : null
  }

  return (
    <div className="waypoint-popup">
      <div className="waypoint-popup-subheader">Shared station</div>
      {activeMembers.length > 0 ? (
        <div className="background-station-list">
          {activeMembers.map((member) => (
            <div key={`active-${member.waypoint.id}`} className="background-station-item">
              <strong>{member.waypoint.label}</strong>
              <span>Current line</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="background-station-list">
        {backgroundMembers.map((member) => {
          const nearest = getNearestActiveStation(member.waypoint.lat, member.waypoint.lon)
          return (
            <div key={`${member.routeId}-${member.waypoint.id}`} className="background-station-item">
              <strong>{member.waypoint.label}</strong>
              <span>{member.routeFilename}</span>
              {nearest ? (
                <button
                  type="button"
                  className="waypoint-copy-button background-add-button"
                  onClick={() =>
                    onMergeBackgroundStation(
                      nearest.waypoint.id,
                      member.waypoint.label,
                      member.waypoint.altLabels,
                      member.waypoint.lat,
                      member.waypoint.lon,
                    )
                  }
                  title={`Merge: replace "${nearest.waypoint.label}" with "${member.waypoint.label}"`}
                >
                  Merge with {nearest.waypoint.label}
                </button>
              ) : null}
              <button
                type="button"
                className="waypoint-copy-button background-add-button"
                onClick={() =>
                  onReuseBackgroundStation(
                    member.waypoint.label,
                    member.waypoint.altLabels,
                    group.lat,
                    group.lon,
                    false,
                  )
                }
              >
                Add to this line
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const RouteMap = memo(function RouteMap({
  waypoints,
  activeRouteFilename,
  backgroundRoutes,
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
  onMoveSharedStationPosition,
  onSelectWaypoint,
  onReuseBackgroundStation,
  onMergeBackgroundStation,
  onHoverWaypoint,
  onUnhoverWaypoint,
}: RouteMapProps) {
  const [draggingTarget, setDraggingTarget] = useState<DraggingTarget | null>(null)
  const [suppressExternalClickUntil, setSuppressExternalClickUntil] = useState(0)
  const [pendingPopupWaypointId, setPendingPopupWaypointId] = useState<string | null>(null)
  const [openPopupId, setOpenPopupId] = useState<string | null>(null)
  const markerRefs = useRef(new Map<string, LeafletCircleMarker>())
  const pendingInsertedStationWaypointIds = useRef<Set<string> | null>(null)

  function handleInsertStationAndEdit(lat: number, lon: number) {
    pendingInsertedStationWaypointIds.current = new Set(waypoints.map((waypoint) => waypoint.id))
    onInsertWaypoint(false, lat, lon)
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

  const stationGroups = useMemo(() => {
    const groups = new Map<string, BackgroundStationGroup>()

    for (const waypoint of waypoints) {
      const key = toCoordinateKey(waypoint.lat, waypoint.lon)
      const existing = groups.get(key)
      if (existing) {
        existing.members.push({
          routeId: 'active',
          routeFilename: activeRouteFilename ?? 'Current line',
          waypoint,
          isActive: true,
        })
        continue
      }

      groups.set(key, {
        key,
        lat: waypoint.lat,
        lon: waypoint.lon,
        members: [
          {
            routeId: 'active',
            routeFilename: activeRouteFilename ?? 'Current line',
            waypoint,
            isActive: true,
          },
        ],
      })
    }

    for (const route of backgroundRoutes) {
      for (const waypoint of route.waypoints) {
        const key = toCoordinateKey(waypoint.lat, waypoint.lon)
        const existing = groups.get(key)
        if (existing) {
          existing.members.push({ routeId: route.id, routeFilename: route.filename, waypoint, isActive: false })
          continue
        }

        groups.set(key, {
          key,
          lat: waypoint.lat,
          lon: waypoint.lon,
          members: [{ routeId: route.id, routeFilename: route.filename, waypoint, isActive: false }],
        })
      }
    }

    return Array.from(groups.values())
  }, [activeRouteFilename, backgroundRoutes, waypoints])

  const groupedStationGroups = useMemo(
    () =>
      stationGroups.filter((group) => {
        const hasActiveMember = group.members.some((member) => member.isActive)
        const hasBackgroundMember = group.members.some((member) => !member.isActive)
        const activeMemberCount = group.members.filter((member) => member.isActive).length

        // If a station exists on the active line, use the normal active-station marker behavior.
        if (hasActiveMember) {
          return false
        }

        return hasBackgroundMember || activeMemberCount > 1
      }),
    [stationGroups],
  )

  const sharedWithBackgroundCoordinateKeys = useMemo(() => {
    const keys = new Set<string>()

    for (const group of stationGroups) {
      const hasActiveMember = group.members.some((member) => member.isActive)
      const hasBackgroundMember = group.members.some((member) => !member.isActive)
      if (hasActiveMember && hasBackgroundMember) {
        keys.add(group.key)
      }
    }

    return keys
  }, [stationGroups])

  const groupedCoordinateKeys = useMemo(
    () => new Set(groupedStationGroups.map((group) => group.key)),
    [groupedStationGroups],
  )

  const positions = useMemo(
    () =>
      waypoints.map((waypoint) => {
        if (draggingTarget?.kind === 'waypoint' && draggingTarget.payload.waypointId === waypoint.id) {
          return [draggingTarget.payload.lat, draggingTarget.payload.lon] as [number, number]
        }

        if (
          draggingTarget?.kind === 'shared-station' &&
          sameCoordinate(waypoint.lat, waypoint.lon, draggingTarget.payload.sourceLat, draggingTarget.payload.sourceLon)
        ) {
          return [draggingTarget.payload.lat, draggingTarget.payload.lon] as [number, number]
        }

        return [waypoint.lat, waypoint.lon] as [number, number]
      }),
    [draggingTarget, waypoints],
  )

  const renderedWaypoints = useMemo(
    () =>
      waypoints.map((waypoint) =>
        draggingTarget?.kind === 'waypoint' && draggingTarget.payload.waypointId === waypoint.id
          ? {
              ...waypoint,
              lat: draggingTarget.payload.lat,
              lon: draggingTarget.payload.lon,
            }
          : draggingTarget?.kind === 'shared-station' &&
              sameCoordinate(waypoint.lat, waypoint.lon, draggingTarget.payload.sourceLat, draggingTarget.payload.sourceLon)
            ? {
                ...waypoint,
                lat: draggingTarget.payload.lat,
                lon: draggingTarget.payload.lon,
              }
          : waypoint,
      ),
    [draggingTarget, waypoints],
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
  const isLargeRoute = renderedWaypoints.length >= 180
  const thicknessMultiplier = lineWeight / 4
  const corridorWaypoints = useMemo(
    () => (isLargeRoute ? sampleWaypointsForCorridor(renderedWaypoints, 120) : renderedWaypoints),
    [isLargeRoute, renderedWaypoints],
  )
  const highlightLines = useMemo(
    () => calcHighlightLines(corridorWaypoints, 20 * thicknessMultiplier),
    [corridorWaypoints, thicknessMultiplier],
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
          isDraggingWaypoint={draggingTarget !== null}
          suppressExternalClickUntil={suppressExternalClickUntil}
        />
        <WaypointDragHandler
          isDragging={draggingTarget !== null}
          onPreviewWaypoint={(lat, lon) => {
            setDraggingTarget((current) => {
              if (!current) {
                return null
              }

              if (current.kind === 'waypoint') {
                return {
                  ...current,
                  payload: {
                    ...current.payload,
                    lat,
                    lon,
                  },
                }
              }

              return {
                ...current,
                payload: {
                  ...current.payload,
                  lat,
                  lon,
                },
              }
            })
          }}
          onCommitWaypoint={(lat, lon) => {
            if (!draggingTarget) {
              return
            }

            if (draggingTarget.kind === 'waypoint') {
              onMoveWaypointPosition(draggingTarget.payload.waypointId, lat, lon)
            } else {
              onMoveSharedStationPosition(
                draggingTarget.payload.sourceLat,
                draggingTarget.payload.sourceLon,
                lat,
                lon,
              )
            }

            setDraggingTarget(null)
            setSuppressExternalClickUntil(performance.now() + 250)
          }}
        />
        {backgroundRoutes.map((route, routeIndex) => {
          const routeColor = backgroundRouteColors[routeIndex % backgroundRouteColors.length]
          const routePositions = route.waypoints.map((waypoint) => [waypoint.lat, waypoint.lon] as [number, number])

          return (
            <Fragment key={`${route.id}-background`}>
              {routePositions.length > 1 ? (
                <Polyline
                  key={`${route.id}-bg-line`}
                  positions={routePositions}
                  pathOptions={{
                    color: routeColor,
                    weight: Math.max(3, 5 * thicknessMultiplier),
                    opacity: 0.55,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                >
                  <Tooltip sticky opacity={0.94}>
                    {route.filename}
                  </Tooltip>
                </Polyline>
              ) : null}
            </Fragment>
          )
        })}
        {positions.length > 1 ? (
          <>
            {corridorPolygon.length > 2 ? (
              <Polygon
                positions={corridorPolygon}
                interactive={false}
                pathOptions={{
                  stroke: false,
                  fillColor: '#ff6b5f',
                  fillOpacity: 0.26,
                  fillRule: 'nonzero',
                }}
              />
            ) : null}
            <Polyline
              positions={positions}
              interactive={false}
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
        {groupedStationGroups.map((group, groupIndex) => {
          const routeColor = backgroundRouteColors[groupIndex % backgroundRouteColors.length]
          const activeMembers = group.members.filter((member) => member.isActive)
          const hasActiveStation = activeMembers.some((member) => !member.waypoint.hidden)
          const hasActiveGeometry = activeMembers.length > 0 && !hasActiveStation

          return (
            <CircleMarker
              key={`bg-group-${group.key}`}
              center={[
                draggingTarget?.kind === 'shared-station' &&
                sameCoordinate(group.lat, group.lon, draggingTarget.payload.sourceLat, draggingTarget.payload.sourceLon)
                  ? draggingTarget.payload.lat
                  : group.lat,
                draggingTarget?.kind === 'shared-station' &&
                sameCoordinate(group.lat, group.lon, draggingTarget.payload.sourceLat, draggingTarget.payload.sourceLon)
                  ? draggingTarget.payload.lon
                  : group.lon,
              ]}
              radius={Math.max(5, Math.min(9, lineWeight + 1))}
              bubblingMouseEvents={false}
              pathOptions={{
                color: hasActiveStation ? '#111827' : hasActiveGeometry ? '#8f5d12' : routeColor,
                fillColor: hasActiveStation ? '#fff7eb' : hasActiveGeometry ? '#f1c15a' : routeColor,
                fillOpacity: hasActiveStation || hasActiveGeometry ? 0.98 : 0.46,
                weight: hasActiveStation ? 3 : hasActiveGeometry ? 2 : 1,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.92}>
                {`${group.members.length} station${group.members.length > 1 ? 's' : ''}${hasActiveStation ? ' · on this line' : ''}`}
              </Tooltip>
              <Popup
                eventHandlers={{
                  add: () => setOpenPopupId(`bg-${group.key}`),
                  remove: () => setOpenPopupId((prev) => prev === `bg-${group.key}` ? null : prev),
                }}
              >
                {openPopupId === `bg-${group.key}` ? (
                  <BackgroundStationPopupContent
                    group={group}
                    waypoints={waypoints}
                    onReuseBackgroundStation={onReuseBackgroundStation}
                    onMergeBackgroundStation={onMergeBackgroundStation}
                  />
                ) : null}
              </Popup>
            </CircleMarker>
          )
        })}
        {renderedWaypoints.map((waypoint, index) => {
          if (groupedCoordinateKeys.has(toCoordinateKey(waypoint.lat, waypoint.lon))) {
            return null
          }

          const isInUse = inUseLabelSet.has(waypoint.label)
          const issueCodes = issueMap.get(index + 1) ?? []
          const stationRadius = waypoint.hidden ? 5 : Math.max(7, Math.min(14, lineWeight + 3))
          const coordinateKey = toCoordinateKey(waypoint.lat, waypoint.lon)
          const isInterchange = sharedWithBackgroundCoordinateKeys.has(coordinateKey)
          const showMarkerOverlay =
            !isLargeRoute ||
            focusWaypointId === waypoint.id ||
            openPopupId === waypoint.id ||
            pendingPopupWaypointId === waypoint.id

          return (
            <Fragment key={waypoint.id}>
              <CircleMarker
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
                  mouseover: () => {
                    if (!waypoint.hidden) {
                      onHoverWaypoint(waypoint.id)
                    }
                  },
                  mouseout: () => {
                    onUnhoverWaypoint()
                  },
                  mousedown: (event) => {
                    if (focusWaypointId !== waypoint.id) {
                      return
                    }

                    event.originalEvent.preventDefault()
                    event.originalEvent.stopPropagation()
                    if (isInterchange) {
                      setDraggingTarget({
                        kind: 'shared-station',
                        payload: {
                          sourceLat: waypoint.lat,
                          sourceLon: waypoint.lon,
                          lat: waypoint.lat,
                          lon: waypoint.lon,
                        },
                      })
                      return
                    }

                    setDraggingTarget({
                      kind: 'waypoint',
                      payload: {
                        waypointId: waypoint.id,
                        lat: waypoint.lat,
                        lon: waypoint.lon,
                      },
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
                  color: issueCodes.length > 0 ? '#9f2d1d' : isInterchange ? '#0891b2' : isInUse ? '#144d46' : waypoint.hidden ? '#8f5d12' : '#111827',
                  fillColor: issueCodes.length > 0 ? '#fff1bf' : isInterchange ? '#cffafe' : isInUse ? '#2fa67f' : waypoint.hidden ? '#f1c15a' : '#fff7eb',
                  fillOpacity: 0.98,
                  weight: isInterchange ? 3 : waypoint.hidden ? 2 : 3,
                }}
              >
                {showMarkerOverlay ? (
                  <>
                    <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                      {`${index + 1}. ${waypoint.label}`}
                    </Tooltip>
                    <Popup
                      eventHandlers={{
                        add: () => setOpenPopupId(waypoint.id),
                        remove: () => setOpenPopupId((prev) => prev === waypoint.id ? null : prev),
                      }}
                    >
                      {openPopupId === waypoint.id ? (
                        <WaypointPopupContent
                          waypoint={waypoint}
                          issueCodes={issueCodes}
                          onRenameWaypoint={onRenameWaypoint}
                          onSetAltLabels={onSetAltLabels}
                          onToggleWaypointKind={onToggleWaypointKind}
                          onDeleteWaypoint={onDeleteWaypoint}
                        />
                      ) : null}
                    </Popup>
                  </>
                ) : null}
              </CircleMarker>
              {issueCodes.length > 0 && !isLargeRoute ? (
                <Marker
                  key={`${waypoint.id}-warning`}
                  position={[waypoint.lat, waypoint.lon]}
                  icon={warningIcon}
                  interactive={false}
                  zIndexOffset={1000}
                />
              ) : null}
            </Fragment>
          )
        })}
      </MapContainer>
    </div>
  )
})
