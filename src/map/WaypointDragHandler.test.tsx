import { cleanup, fireEvent, render } from '@testing-library/react'
import { point } from 'leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WaypointDragHandler } from './WaypointDragHandler'
import type { WaypointDragStart } from './WaypointDragHandler'

const { map } = vi.hoisted(() => ({
  map: {
    dragging: { enabled: vi.fn(), disable: vi.fn(), enable: vi.fn() },
    doubleClickZoom: { enabled: vi.fn(), disable: vi.fn(), enable: vi.fn() },
    latLngToContainerPoint: vi.fn(),
    mouseEventToContainerPoint: vi.fn(),
    containerPointToLatLng: vi.fn(),
  },
}))

vi.mock('react-leaflet', () => ({ useMap: () => map }))

beforeEach(() => {
  map.dragging.enabled.mockReturnValue(true)
  map.doubleClickZoom.enabled.mockReturnValue(true)
  map.latLngToContainerPoint.mockImplementation(([lat, lon]: [number, number]) => point(lon * 10, lat * 10))
  map.mouseEventToContainerPoint.mockImplementation((event: MouseEvent) => point(event.clientX, event.clientY))
  map.containerPointToLatLng.mockImplementation(({ x, y }: { x: number; y: number }) => ({ lat: y / 10, lng: x / 10 }))
})
afterEach(cleanup)

function setup() {
  const start: WaypointDragStart = { pointer: point(104, 203), position: [20, 10] }
  const callbacks = {
    onPreviewWaypoint: vi.fn(),
    onCommitWaypoint: vi.fn(),
    onCancel: vi.fn(),
  }
  const view = render(<WaypointDragHandler start={start} {...callbacks} />)
  return { ...view, start, ...callbacks }
}

describe('waypoint dragging', () => {
  it('leaves an off-center click unchanged', () => {
    const callbacks = setup()
    fireEvent.mouseUp(document, { clientX: 104, clientY: 203, button: 0 })
    expect(callbacks.onPreviewWaypoint).not.toHaveBeenCalled()
    expect(callbacks.onCommitWaypoint).not.toHaveBeenCalled()
    expect(callbacks.onCancel).toHaveBeenCalledOnce()
  })

  it('ignores motion below 5 pixels, including on release', () => {
    const callbacks = setup()
    fireEvent.mouseMove(document, { clientX: 107, clientY: 206 })
    fireEvent.mouseUp(document, { clientX: 107, clientY: 206, button: 0 })
    expect(callbacks.onPreviewWaypoint).not.toHaveBeenCalled()
    expect(callbacks.onCommitWaypoint).not.toHaveBeenCalled()
    expect(callbacks.onCancel).toHaveBeenCalledOnce()
  })

  it('starts at exactly 5 pixels and preserves the grab offset', () => {
    const callbacks = setup()
    fireEvent.mouseMove(document, { clientX: 107, clientY: 207 })
    expect(callbacks.onPreviewWaypoint).toHaveBeenCalledWith(20.4, 10.3)
    fireEvent.mouseUp(document, { clientX: 114, clientY: 213, button: 0 })
    expect(callbacks.onCommitWaypoint).toHaveBeenCalledWith(21, 11)
    expect(callbacks.onCancel).not.toHaveBeenCalled()
  })

  it('recognizes a drag that first crosses the threshold on release', () => {
    const callbacks = setup()
    fireEvent.mouseUp(document, { clientX: 110, clientY: 203, button: 0 })
    expect(callbacks.onCommitWaypoint).toHaveBeenCalledWith(20, 10.6)
  })

  it('keeps dragging across preview rerenders even when returning inside the threshold', () => {
    const callbacks = setup()
    fireEvent.mouseMove(document, { clientX: 114, clientY: 203 })
    const commit = vi.fn()
    callbacks.rerender(<WaypointDragHandler start={callbacks.start}
      onPreviewWaypoint={callbacks.onPreviewWaypoint} onCommitWaypoint={commit} onCancel={callbacks.onCancel} />)
    fireEvent.mouseUp(document, { clientX: 105, clientY: 203, button: 0 })
    expect(commit).toHaveBeenCalledWith(20, 10.1)
    expect(callbacks.onCommitWaypoint).not.toHaveBeenCalled()
  })

  it('restores map interactions and removes document listeners after finishing', () => {
    const callbacks = setup()
    expect(map.dragging.disable).toHaveBeenCalledOnce()
    expect(map.doubleClickZoom.disable).toHaveBeenCalledOnce()
    callbacks.rerender(<WaypointDragHandler {...callbacks} start={null} />)
    expect(map.dragging.enable).toHaveBeenCalledOnce()
    expect(map.doubleClickZoom.enable).toHaveBeenCalledOnce()
    fireEvent.mouseMove(document, { clientX: 120, clientY: 203 })
    fireEvent.mouseUp(document, { clientX: 120, clientY: 203 })
    expect(callbacks.onPreviewWaypoint).not.toHaveBeenCalled()
    expect(callbacks.onCommitWaypoint).not.toHaveBeenCalled()
  })

  it('does not enable map interactions that were already disabled', () => {
    map.dragging.enabled.mockReturnValue(false)
    map.doubleClickZoom.enabled.mockReturnValue(false)
    const view = setup()
    view.unmount()
    expect(map.dragging.enable).not.toHaveBeenCalled()
    expect(map.doubleClickZoom.enable).not.toHaveBeenCalled()
  })

  it('cancels on window blur and ignores non-left-button releases', () => {
    const callbacks = setup()
    fireEvent.mouseUp(document, { clientX: 120, clientY: 203, button: 2 })
    expect(callbacks.onCommitWaypoint).not.toHaveBeenCalled()
    expect(callbacks.onCancel).not.toHaveBeenCalled()
    fireEvent.blur(window)
    expect(callbacks.onCancel).toHaveBeenCalledOnce()
  })
})
