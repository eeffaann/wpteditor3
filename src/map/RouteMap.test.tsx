import type { ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteMap, type RouteMapProps } from './RouteMap'
import { parseWpt } from '../wpt/parseWpt'

const map = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  setView: vi.fn(),
  invalidateSize: vi.fn(),
  getContainer: vi.fn(),
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  CircleMarker: () => null,
  Marker: () => null,
  Polygon: () => null,
  Polyline: () => null,
  Popup: () => null,
  Tooltip: () => null,
  useMap: () => map,
  useMapEvents: () => map,
}))

const waypoints = parseWpt('Alpha http://www.openstreetmap.org/?lat=40&lon=-75\nBeta http://www.openstreetmap.org/?lat=41&lon=-76').waypoints

function mapProps(): RouteMapProps {
  return {
    waypoints,
    activeRouteFilename: 'route.wpt',
    backgroundRoutes: [],
    fitRequest: 1,
    focusWaypointId: null,
    focusRequest: 0,
    lineWeight: 4,
    issues: [],
    inUseLabels: [],
    onSelectRoute: vi.fn(),
    onInsertWaypoint: vi.fn(),
    onRenameWaypoint: vi.fn(),
    onMatchSharedName: vi.fn(),
    onSetAltLabels: vi.fn(),
    onToggleWaypointKind: vi.fn(),
    onDeleteWaypoint: vi.fn(),
    onMoveWaypointPosition: vi.fn(),
    onMoveSharedStationPosition: vi.fn(),
    onSelectWaypoint: vi.fn(),
    onReuseBackgroundStation: vi.fn(),
    onMergeBackgroundStation: vi.fn(),
    onHoverWaypoint: vi.fn(),
    onUnhoverWaypoint: vi.fn(),
  }
}

beforeEach(() => {
  map.getContainer.mockReturnValue(document.createElement('div'))
})
afterEach(cleanup)

describe('route map viewport', () => {
  it('does not apply an empty route fit request when another route is selected', () => {
    const props = mapProps()
    const view = render(<RouteMap {...props} />)
    expect(map.fitBounds).toHaveBeenCalledOnce()

    view.rerender(<RouteMap {...props} waypoints={[]} fitRequest={2} />)
    view.rerender(<RouteMap {...props} fitRequest={2} />)
    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(map.setView).not.toHaveBeenCalled()

    view.rerender(<RouteMap {...props} fitRequest={3} />)
    expect(map.fitBounds).toHaveBeenCalledTimes(2)
  })

  it('only fits changed waypoint arrays when explicitly requested', () => {
    const props = mapProps()
    const view = render(<RouteMap {...props} />)
    view.rerender(<RouteMap {...props} waypoints={[...waypoints].reverse()} />)
    expect(map.fitBounds).toHaveBeenCalledOnce()

    view.rerender(<RouteMap {...props} waypoints={[waypoints[0]]} fitRequest={2} />)
    expect(map.setView).toHaveBeenCalledWith([40, -75], 14)
    expect(map.fitBounds).toHaveBeenCalledOnce()
  })

  it('consumes an initial empty fit without moving to a later route', () => {
    const props = mapProps()
    const view = render(<RouteMap {...props} waypoints={[]} />)
    view.rerender(<RouteMap {...props} />)
    expect(map.fitBounds).not.toHaveBeenCalled()
    expect(map.setView).not.toHaveBeenCalled()
  })
})
