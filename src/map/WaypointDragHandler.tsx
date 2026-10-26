import { useEffect, useEffectEvent } from 'react'
import type { Point } from 'leaflet'
import { useMap } from 'react-leaflet'

export type WaypointDragStart = {
  pointer: Point
  position: [number, number]
}

const dragThreshold = 5

export function WaypointDragHandler({
  start,
  onPreviewWaypoint,
  onCommitWaypoint,
  onCancel,
}: {
  start: WaypointDragStart | null
  onPreviewWaypoint: (lat: number, lon: number) => void
  onCommitWaypoint: (lat: number, lon: number) => void
  onCancel: () => void
}) {
  const map = useMap()
  const preview = useEffectEvent(onPreviewWaypoint)
  const commit = useEffectEvent(onCommitWaypoint)
  const cancel = useEffectEvent(onCancel)

  useEffect(() => {
    if (!start) {
      return
    }

    const { pointer: startPointer, position: startPosition } = start
    const wasDraggingEnabled = map.dragging.enabled()
    const wasDoubleClickZoomEnabled = map.doubleClickZoom.enabled()
    const origin = map.latLngToContainerPoint(startPosition)
    let hasDragged = false
    map.dragging.disable()
    map.doubleClickZoom.disable()

    function positionFor(event: MouseEvent) {
      const pointer = map.mouseEventToContainerPoint(event)
      if (pointer.distanceTo(startPointer) >= dragThreshold) {
        hasDragged = true
      }
      return hasDragged
        ? map.containerPointToLatLng(origin.add(pointer.subtract(startPointer)))
        : null
    }

    function onMouseMove(event: MouseEvent) {
      const position = positionFor(event)
      if (position) {
        preview(position.lat, position.lng)
      }
    }

    function onMouseUp(event: MouseEvent) {
      if (event.button !== 0) {
        return
      }
      const position = positionFor(event)
      if (position) {
        commit(position.lat, position.lng)
      } else {
        cancel()
      }
    }

    function onBlur() {
      cancel()
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    window.addEventListener('blur', onBlur)

    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('blur', onBlur)
      if (wasDraggingEnabled) map.dragging.enable()
      if (wasDoubleClickZoomEnabled) map.doubleClickZoom.enable()
    }
  }, [start, map])

  return null
}
