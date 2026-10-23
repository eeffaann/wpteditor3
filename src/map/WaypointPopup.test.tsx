import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WaypointPopupContent } from './WaypointPopup'
import { parseWpt } from '../wpt/parseWpt'

vi.mock('react-leaflet', () => ({ useMap: () => ({ closePopup: vi.fn() }) }))
afterEach(cleanup)
const waypoint = parseWpt('Alpha Alt http://www.openstreetmap.org/?lat=40&lon=-75').waypoints[0]
const callbacks = () => ({
  onRenameWaypoint: vi.fn(), onSetAltLabels: vi.fn(), onToggleWaypointKind: vi.fn(), onDeleteWaypoint: vi.fn(),
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
})
