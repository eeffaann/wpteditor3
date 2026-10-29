import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { CircleMarker as LeafletCircleMarker, LatLngBounds, divIcon } from 'leaflet'
import type { ParseIssue, Waypoint } from '../editor/editorTypes'
import { sameCoordinate, toCoordinateKey, toMercatorPoint } from '../wpt/geometry'
import { WaypointPopupContent } from './WaypointPopup'
import { WaypointDragHandler } from './WaypointDragHandler'
import type { WaypointDragStart } from './WaypointDragHandler'

export type RouteMapProps = {
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
  onSelectRoute: (routeId: string) => void
  onInsertWaypoint: (hidden: boolean, lat: number, lon: number) => void
  onRenameWaypoint: (waypointId: string, nextLabel: string) => void
  onMatchSharedName: (waypointId: string, routeId: string, otherWaypointId: string, direction: 'use-other' | 'use-current') => void
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

type DraggingTarget = (
  | { kind: 'waypoint'; payload: DraggingWaypoint }
  | { kind: 'shared-station'; payload: DraggingSharedStation }
) & { start: WaypointDragStart }

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
  return toMercatorPoint(waypoint.lat, waypoint.lon)
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
  const lastHandledFitRequest = useRef(0)

  useEffect(() => {
    if (fitRequest === 0 || fitRequest === lastHandledFitRequest.current) {
      return
    }

    // Consume empty-route requests so later route selection cannot replay them.
    lastHandledFitRequest.current = fitRequest
    if (waypoints.length === 0) return
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
  onSelectRoute,
  onInsertWaypoint,
  onRenameWaypoint,
  onMatchSharedName,
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

        // Active markers already provide selection, dragging, and popup editing.
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
    const nextMap = new Map<string, string[]>()

    for (const issue of issues) {
      if (!issue.waypointId) continue
      const codes = nextMap.get(issue.waypointId) ?? []
      if (!codes.includes(issue.message)) {
        codes.push(issue.message)
      }
      nextMap.set(issue.waypointId, codes)
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
          start={draggingTarget?.start ?? null}
          onCancel={() => setDraggingTarget(null)}
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
                  bubblingMouseEvents={false}
                  eventHandlers={{
                    click: () => {
                      if (draggingTarget || performance.now() < suppressExternalClickUntil) {
                        return
                      }

                      onSelectRoute(route.id)
                    },
                  }}
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
          const issueCodes = issueMap.get(waypoint.id) ?? []
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
                    if (focusWaypointId !== waypoint.id || event.originalEvent.button !== 0) {
                      return
                    }

                    event.originalEvent.preventDefault()
                    event.originalEvent.stopPropagation()
                    const start: WaypointDragStart = {
                      pointer: event.containerPoint,
                      position: [waypoint.lat, waypoint.lon],
                    }
                    if (isInterchange) {
                      setDraggingTarget({
                        start,
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
                      start,
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
                        add: () => {
                          setOpenPopupId(waypoint.id)
                          setPendingPopupWaypointId(null)
                        },
                        remove: () => setOpenPopupId((prev) => prev === waypoint.id ? null : prev),
                      }}
                    >
                      {openPopupId === waypoint.id ? (
                        <WaypointPopupContent
                          waypoint={waypoint}
                          issueCodes={issueCodes}
                          concurrentWaypoints={stationGroups.find((group) => group.key === coordinateKey)?.members.filter((member) => !member.isActive) ?? []}
                          onRenameWaypoint={onRenameWaypoint}
                          onMatchSharedName={onMatchSharedName}
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
