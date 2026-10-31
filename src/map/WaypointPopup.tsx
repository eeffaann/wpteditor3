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

function WaypointLabelInput({ label, ariaLabel, autoFocus = false, onCommit }: {
  label: string
  ariaLabel: string
  autoFocus?: boolean
  onCommit: (label: string) => void
}) {
  const map = useMap()
  const [draft, setDraft] = useState({ original: label, value: label })
  const value = draft.original === label ? draft.value : label

  function commit() {
    const nextLabel = value.trim()
    if (nextLabel && nextLabel !== label) onCommit(nextLabel)
  }

  return (
    <input className="waypoint-popup-title-input" type="text" aria-label={ariaLabel} autoFocus={autoFocus}
      value={value} onChange={(event) => setDraft({ original: label, value: event.target.value })}
      onBlur={commit} onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        event.stopPropagation()
        commit()
        map.closePopup()
      }} />
  )
}

export function WaypointPopupContent({ waypoint, issueCodes, concurrentWaypoints = [], onRenameWaypoint, onMatchSharedName, onSetAltLabels, onToggleWaypointKind, onDeleteWaypoint }: Props) {
  const map = useMap()
  const altLabels = waypoint.altLabels.join(' ')
  const [editingAltLabels, setEditingAltLabels] = useState(false)
  const [altDraft, setAltDraft] = useState({ original: altLabels, value: altLabels })
  const [copyStatus, setCopyStatus] = useState<{ line: string; message: string } | null>(null)
  const draftAltLabels = altDraft.original === altLabels ? altDraft.value : altLabels
  const waypointLine = exportWaypointLine(waypoint)

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
        <WaypointLabelInput label={waypoint.label} ariaLabel="Waypoint label" autoFocus
          onCommit={(label) => onRenameWaypoint(waypoint.id, label)} />
      </div>
      {issueCodes.length > 0 ? <div className="waypoint-popup-issues">{issueCodes.join(' · ')}</div> : null}
      <button type="button" className="waypoint-copy-button waypoint-alt-labels-button"
        aria-expanded={editingAltLabels} onClick={() => {
          if (editingAltLabels) commitAltLabels()
          setEditingAltLabels((current) => !current)
        }}>
        {editingAltLabels ? 'Hide alt labels' : 'Edit alt labels'}
      </button>
      {editingAltLabels ? <label className="waypoint-popup-field">
        <span>Alt labels</span>
        <input className="waypoint-popup-field-input" type="text" value={draftAltLabels}
          placeholder="Alt labels separated by spaces"
          onChange={(event) => setAltDraft({ original: altLabels, value: event.target.value })}
          onBlur={commitAltLabels} onKeyDown={(event) => handleEnter(event, commitAltLabels)} />
      </label> : null}
      {!waypoint.hidden && concurrentWaypoints.some((member) => !member.waypoint.hidden) ? (
        <div className="waypoint-popup-field">
          <span>Names on concurrent routes</span>
          <div className="background-station-list">
            {concurrentWaypoints.filter((member) => !member.waypoint.hidden).map((member) => (
              <div key={`${member.routeId}-${member.waypoint.id}`} className="background-station-item">
                <span>{member.routeFilename}</span>
                <WaypointLabelInput label={member.waypoint.label} ariaLabel={`Waypoint label on ${member.routeFilename}`}
                  onCommit={(label) => onRenameWaypoint(member.waypoint.id, label, member.routeId)} />
                <div className="waypoint-popup-action-row">
                  <button type="button" className="waypoint-copy-button"
                    disabled={member.waypoint.label === waypoint.label}
                    aria-label={`Copy From ${member.routeFilename}`}
                    onClick={() => onMatchSharedName(waypoint.id, member.routeId, member.waypoint.id, 'use-other')}>
                    Copy From
                  </button>
                  <button type="button" className="waypoint-copy-button"
                    disabled={member.waypoint.label === waypoint.label}
                    aria-label={`Copy To ${member.routeFilename}`}
                    onClick={() => onMatchSharedName(waypoint.id, member.routeId, member.waypoint.id, 'use-current')}>
                    Copy To
                  </button>
                </div>
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
