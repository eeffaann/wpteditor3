import { useMemo, useState, type RefObject } from 'react'
import type { ParseIssue, Waypoint } from './editorTypes'
import { mileage } from '../wpt/geometry'

type RouteTableProps = {
  waypoints: Waypoint[]
  issues: ParseIssue[]
  shellRef: RefObject<HTMLDivElement | null>
  onFocus: (id: string) => void
  onHoverLine: (lineIndex: number) => void
  onMove: (from: number, to: number) => void
  onDelete: (id: string) => void
}

export function RouteTable({ waypoints, issues, shellRef, onFocus, onHoverLine, onMove, onDelete }: RouteTableProps) {
  const [distanceUnit, setDistanceUnit] = useState<'mi' | 'km'>('mi')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const rows = useMemo(() => {
    const rows: Array<{ waypoint: Waypoint; segment: number; total: number; issues: string[] }> = []
    for (const [index, waypoint] of waypoints.entries()) {
      const previous = waypoints[index - 1]
      const segment = previous ? mileage(previous.lat, previous.lon, waypoint.lat, waypoint.lon) : 0
      rows.push({
        waypoint, segment, total: (rows.at(-1)?.total ?? 0) + segment,
        issues: issues.filter((issue) => issue.waypointId === waypoint.id).map((issue) => issue.message),
      })
    }
    return rows
  }, [waypoints, issues])
  const distance = (value: number) => (distanceUnit === 'km' ? value * 1.609344 : value).toFixed(2)

  return (
    <article className="panel panel-condensed">
      <div className="panel-heading compact">
        <div>
          <h2>Route Table</h2>
          <p>Drag rows to reorder.</p>
        </div>
        <div className="distance-toggle" role="group" aria-label="Distance unit">
          {(['mi', 'km'] as const).map((unit) => (
            <button key={unit} type="button" aria-pressed={distanceUnit === unit}
              className={distanceUnit === unit ? 'distance-toggle-active' : undefined}
              onClick={() => setDistanceUnit(unit)}>{unit}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <p className="empty-state">Load a route to inspect and reorder its waypoint table.</p> : (
        <div ref={shellRef} className="route-table-shell">
          <table className="route-table">
            <thead><tr>
              <th scope="col">#</th><th scope="col">Label</th><th scope="col">Type</th>
              <th scope="col">Lat</th><th scope="col">Lon</th>
              <th scope="col">Seg. {distanceUnit}</th><th scope="col">Tot. {distanceUnit}</th><th scope="col">Move</th>
            </tr></thead>
            <tbody>
              {rows.map(({ waypoint, segment, total, issues: codes }, index) => (
                <tr key={waypoint.id} data-waypoint-id={waypoint.id}
                  className={`${waypoint.hidden ? 'route-row-hidden' : ''} ${codes.length ? 'route-row-has-issues' : ''} ${draggedId === waypoint.id ? 'route-row-dragging' : ''}`.trim()}
                  draggable onMouseEnter={() => onHoverLine((waypoint.sourceLine ?? index + 1) - 1)}
                  onClick={() => onFocus(waypoint.id)} onDragStart={() => setDraggedId(waypoint.id)}
                  onDragEnd={() => setDraggedId(null)} onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const from = waypoints.findIndex((candidate) => candidate.id === draggedId)
                    if (from >= 0) onMove(from, index)
                    setDraggedId(null)
                  }}>
                  <td>{index + 1}</td>
                  <td className="route-row-label-cell">
                    <button type="button" onClick={(event) => { event.stopPropagation(); onFocus(waypoint.id) }}
                      aria-label={`Focus ${waypoint.label}`}>{waypoint.label}</button>
                    {waypoint.altLabels.length > 0 ? <div className="route-row-alt-labels">{waypoint.altLabels.join(' ')}</div> : null}
                    {codes.length > 0 ? <div className="route-row-issues">{codes.join(' · ')}</div> : null}
                  </td>
                  <td>{waypoint.hidden ? 'Geo' : 'Station'}</td>
                  <td>{waypoint.lat.toFixed(6)}</td><td>{waypoint.lon.toFixed(6)}</td>
                  <td>{distance(segment)}</td><td>{distance(total)}</td>
                  <td><div className="route-row-move-actions">
                    <button type="button" className="route-row-move-button" disabled={index === 0}
                      aria-label={`Move ${waypoint.label} up`}
                      onClick={(event) => { event.stopPropagation(); onMove(index, index - 1) }}>↑</button>
                    <button type="button" className="route-row-move-button" disabled={index === rows.length - 1}
                      aria-label={`Move ${waypoint.label} down`}
                      onClick={(event) => { event.stopPropagation(); onMove(index, index + 1) }}>↓</button>
                    <button type="button" className="route-row-move-button route-row-remove-button"
                      aria-label={`Remove ${waypoint.label}`}
                      onClick={(event) => { event.stopPropagation(); onDelete(waypoint.id) }}>🗑</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}
