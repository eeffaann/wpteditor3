import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WaypointPopupContent } from './WaypointPopup'
import { parseWpt } from '../wpt/parseWpt'

vi.mock('react-leaflet', () => ({ useMap: () => ({ closePopup: vi.fn() }) }))
afterEach(cleanup)
const waypoint = parseWpt('Alpha Alt http://www.openstreetmap.org/?lat=40&lon=-75').waypoints[0]
const callbacks = () => ({
  onRenameWaypoint: vi.fn(), onMatchSharedName: vi.fn(), onSetAltLabels: vi.fn(), onToggleWaypointKind: vi.fn(), onDeleteWaypoint: vi.fn(),
})

describe('waypoint popup', () => {
  it('commits drafts and reflects external shared-name changes without synchronizing effects', () => {
    const props = { waypoint, issueCodes: [], ...callbacks() }
    const view = render(<WaypointPopupContent {...props} />)
    const input = screen.getByRole('textbox', { name: 'Waypoint label' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.blur(input)
    expect(props.onRenameWaypoint).toHaveBeenCalledWith(waypoint.id, 'Renamed')
    view.rerender(<WaypointPopupContent {...props} waypoint={{ ...waypoint, label: 'External' }} />)
    expect(input.value).toBe('External')
  })

  it('reports copy failures', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    })
    render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...callbacks()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy waypoint line' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Denied'))
  })

  it('offers both naming directions for each concurrent station', () => {
    const props = callbacks()
    const other = { ...waypoint, id: 'other', label: 'Other' }
    render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...props}
      concurrentWaypoints={[{ routeId: 'two', routeFilename: 'two.wpt', waypoint: other }]} />)
    expect(screen.getByText('two.wpt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use Other for this point' }))
    expect(props.onMatchSharedName).toHaveBeenCalledWith(waypoint.id, 'two', 'other', 'use-other')
    fireEvent.click(screen.getByRole('button', { name: 'Use Alpha on two.wpt' }))
    expect(props.onMatchSharedName).toHaveBeenCalledWith(waypoint.id, 'two', 'other', 'use-current')
  })

  it('disables already matching names and omits hidden geometry points', () => {
    render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...callbacks()}
      concurrentWaypoints={[
        { routeId: 'two', routeFilename: 'two.wpt', waypoint },
        { routeId: 'three', routeFilename: 'three.wpt', waypoint: { ...waypoint, hidden: true, label: '+X123456' } },
      ]} />)
    expect((screen.getByRole('button', { name: 'Use Alpha for this point' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Use Alpha on two.wpt' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('three.wpt')).toBeNull()
  })
})
