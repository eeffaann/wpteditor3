import { useState, type KeyboardEvent } from 'react'
import { useMap } from 'react-leaflet'
import type { Waypoint } from '../editor/editorTypes'
import { errorMessage } from '../editor/routeFiles'
import { exportWaypointLine } from '../wpt/exportWpt'
import type { RouteMapProps } from './RouteMap'

type Props = Pick<RouteMapProps, 'onRenameWaypoint' | 'onMatchSharedName' | 'onSetAltLabels' | 'onToggleWaypointKind' | 'onDeleteWaypoint'> & {
  waypoint: Waypoint
  issueCodes: string[]
  concurrentWaypoints?: { routeId: string; routeFilename: string; waypoint: Waypoint }[]
}

export function WaypointPopupContent({ waypoint, issueCodes, concurrentWaypoints = [], onRenameWaypoint, onMatchSharedName, onSetAltLabels, onToggleWaypointKind, onDeleteWaypoint }: Props) {
  const map = useMap()
  const altLabels = waypoint.altLabels.join(' ')
  const [labelDraft, setLabelDraft] = useState({ original: waypoint.label, value: waypoint.label })
  const [altDraft, setAltDraft] = useState({ original: altLabels, value: altLabels })
  const [copyStatus, setCopyStatus] = useState<{ line: string; message: string } | null>(null)
  const draftLabel = labelDraft.original === waypoint.label ? labelDraft.value : waypoint.label
  const draftAltLabels = altDraft.original === altLabels ? altDraft.value : altLabels
  const waypointLine = exportWaypointLine(waypoint)

  function commitLabel() {
    const nextLabel = draftLabel.trim()
    if (nextLabel && nextLabel !== waypoint.label) onRenameWaypoint(waypoint.id, nextLabel)
  }

  function commitAltLabels() {
    const nextAltLabels = draftAltLabels.split(/\s+/).filter(Boolean)
    if (nextAltLabels.join(' ') !== altLabels) onSetAltLabels(waypoint.id, nextAltLabels)
  }

  function handleEnter(event: KeyboardEvent<HTMLInputElement>, commit: () => void) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    commit()
    map.closePopup()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(waypointLine)
      setCopyStatus({ line: waypointLine, message: 'Copied' })
    } catch (error) {
      setCopyStatus({ line: waypointLine, message: `Unable to copy: ${errorMessage(error)}` })
    }
  }

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()
  return (
    <div className="waypoint-popup" onClick={stop} onDoubleClick={stop} onMouseDown={stop}>
      <div className="waypoint-popup-subheader">{waypoint.hidden ? 'Geometry node' : 'Station'}</div>
      <div className="waypoint-popup-title-row">
        <input className="waypoint-popup-title-input" type="text" aria-label="Waypoint label" autoFocus
          value={draftLabel} onChange={(event) => setLabelDraft({ original: waypoint.label, value: event.target.value })}
          onBlur={commitLabel} onKeyDown={(event) => handleEnter(event, commitLabel)} />
      </div>
      {issueCodes.length > 0 ? <div className="waypoint-popup-issues">{issueCodes.join(' · ')}</div> : null}
      <label className="waypoint-popup-field">
        <span>Alt labels</span>
        <input className="waypoint-popup-field-input" type="text" value={draftAltLabels}
          placeholder="Alt labels separated by spaces"
          onChange={(event) => setAltDraft({ original: altLabels, value: event.target.value })}
          onBlur={commitAltLabels} onKeyDown={(event) => handleEnter(event, commitAltLabels)} />
      </label>
      {!waypoint.hidden && concurrentWaypoints.some((member) => !member.waypoint.hidden) ? (
        <div className="waypoint-popup-field">
          <span>Names on concurrent routes</span>
          <div className="background-station-list">
            {concurrentWaypoints.filter((member) => !member.waypoint.hidden).map((member) => (
              <div key={`${member.routeId}-${member.waypoint.id}`} className="background-station-item">
                <strong>{member.waypoint.label}</strong>
                <span>{member.routeFilename}</span>
                <button type="button" className="waypoint-copy-button background-add-button"
                  disabled={member.waypoint.label === waypoint.label}
                  aria-label={`Use ${member.waypoint.label} for this point`}
                  onClick={() => onMatchSharedName(waypoint.id, member.routeId, member.waypoint.id, 'use-other')}>
                  Use this name for current point
                </button>
                <button type="button" className="waypoint-copy-button background-add-button"
                  disabled={member.waypoint.label === waypoint.label}
                  aria-label={`Use ${waypoint.label} on ${member.routeFilename}`}
                  onClick={() => onMatchSharedName(waypoint.id, member.routeId, member.waypoint.id, 'use-current')}>
                  Use current name on this route
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <p>{`${waypoint.lat.toFixed(6)}, ${waypoint.lon.toFixed(6)}`}</p>
      <div className="waypoint-popup-action-row">
        <button type="button" className="waypoint-copy-button waypoint-convert-button" onClick={() => onToggleWaypointKind(waypoint.id)}>
          {waypoint.hidden ? 'Convert to Station' : 'Convert to Geometry Node'}
        </button>
        <button type="button" className="waypoint-copy-button" aria-label="Delete waypoint" title="Delete waypoint"
          onClick={() => onDeleteWaypoint(waypoint.id)}>🗑</button>
        <button type="button" className="waypoint-copy-button" aria-label="Copy waypoint line" title="Copy waypoint line"
          onClick={copy}>🔗</button>
      </div>
      {copyStatus?.line === waypointLine ? <span className="waypoint-copy-status" role="status">{copyStatus.message}</span> : null}
    </div>
  )
}
