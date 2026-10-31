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

  it('hides alternate-label editing by default and saves edits when hiding it', () => {
    const props = callbacks()
    render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...props} />)
    expect(screen.queryByRole('textbox', { name: 'Alt labels' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit alt labels' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Edit alt labels' }))
    const input = screen.getByRole('textbox', { name: 'Alt labels' }) as HTMLInputElement
    expect(input.value).toBe('Alt')
    fireEvent.change(input, { target: { value: 'Old  Older' } })
    fireEvent.click(screen.getByRole('button', { name: 'Hide alt labels' }))
    expect(props.onSetAltLabels).toHaveBeenCalledWith(waypoint.id, ['Old', 'Older'])
    expect(screen.queryByRole('textbox', { name: 'Alt labels' })).toBeNull()
  })

  it('reflects external alternate-label updates and supports clearing them with Enter', () => {
    const props = callbacks()
    const view = render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit alt labels' }))
    const input = screen.getByRole('textbox', { name: 'Alt labels' }) as HTMLInputElement
    view.rerender(<WaypointPopupContent waypoint={{ ...waypoint, altLabels: ['External'] }} issueCodes={[]} {...props} />)
    expect(input.value).toBe('External')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onSetAltLabels).toHaveBeenCalledWith(waypoint.id, [])
  })

  it('edits concurrent names using the correct route and reflects external updates', () => {
    const props = callbacks()
    const member = { routeId: 'two', routeFilename: 'two.wpt', waypoint: { ...waypoint, id: 'other', label: 'Other' } }
    const view = render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...props} concurrentWaypoints={[member]} />)
    const input = screen.getByRole('textbox', { name: 'Waypoint label on two.wpt' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: ' Edited ' } })
    fireEvent.blur(input)
    expect(props.onRenameWaypoint).toHaveBeenCalledWith('other', 'Edited', 'two')
    view.rerender(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...props}
      concurrentWaypoints={[{ ...member, waypoint: { ...member.waypoint, label: 'External' } }]} />)
    expect(input.value).toBe('External')
    fireEvent.change(input, { target: { value: 'EnterName' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRenameWaypoint).toHaveBeenLastCalledWith('other', 'EnterName', 'two')
  })

  it('does not rename a concurrent point to a blank or unchanged name', () => {
    const props = callbacks()
    render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...props}
      concurrentWaypoints={[{ routeId: 'two', routeFilename: 'two.wpt', waypoint }]} />)
    const input = screen.getByRole('textbox', { name: 'Waypoint label on two.wpt' })
    fireEvent.blur(input)
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.blur(input)
    expect(props.onRenameWaypoint).not.toHaveBeenCalled()
  })

  it('offers both naming directions for each concurrent station', () => {
    const props = callbacks()
    const other = { ...waypoint, id: 'other', label: 'Other' }
    render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...props}
      concurrentWaypoints={[{ routeId: 'two', routeFilename: 'two.wpt', waypoint: other }]} />)
    expect(screen.getByText('two.wpt')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy From two.wpt' }).textContent).toBe('Copy From')
    expect(screen.getByRole('button', { name: 'Copy To two.wpt' }).textContent).toBe('Copy To')
    fireEvent.click(screen.getByRole('button', { name: 'Copy From two.wpt' }))
    expect(props.onMatchSharedName).toHaveBeenCalledWith(waypoint.id, 'two', 'other', 'use-other')
    fireEvent.click(screen.getByRole('button', { name: 'Copy To two.wpt' }))
    expect(props.onMatchSharedName).toHaveBeenCalledWith(waypoint.id, 'two', 'other', 'use-current')
  })

  it('disables already matching names and omits hidden geometry points', () => {
    render(<WaypointPopupContent waypoint={waypoint} issueCodes={[]} {...callbacks()}
      concurrentWaypoints={[
        { routeId: 'two', routeFilename: 'two.wpt', waypoint },
        { routeId: 'three', routeFilename: 'three.wpt', waypoint: { ...waypoint, hidden: true, label: '+X123456' } },
      ]} />)
    expect((screen.getByRole('button', { name: 'Copy From two.wpt' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Copy To two.wpt' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('three.wpt')).toBeNull()
  })
})
