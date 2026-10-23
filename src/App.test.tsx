import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { RouteMapProps } from './map/RouteMap'
import type { RoutePickerWindow } from './editor/routeFiles'

vi.mock('./map/RouteMap', () => ({
  RouteMap: (props: RouteMapProps) => (
    <div>
      <span data-testid="map-labels">{props.waypoints.map((waypoint) => waypoint.label).join(',')}</span>
      <button onClick={() => props.onRenameWaypoint(props.waypoints[0].id, 'MapRenamed')}>Rename on map</button>
    </div>
  ),
}))

const text = 'Alpha http://www.openstreetmap.org/?lat=40&lon=-75\nBROKEN\nBeta http://www.openstreetmap.org/?lat=41&lon=-76'
const source = () => screen.getByRole('textbox', { name: 'Route source' }) as HTMLTextAreaElement
const pickerWindow = window as RoutePickerWindow
let writeText = vi.fn()

beforeEach(() => {
  localStorage.clear()
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete pickerWindow.showSaveFilePicker
  delete pickerWindow.showDirectoryPicker
})

function addRoute(value = text) {
  fireEvent.change(source(), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Add Route' }))
}

describe('editor UI integration', () => {
  it('synchronizes typing, the map, the table, copy and map edits without losing invalid text', async () => {
    render(<App />)
    addRoute()
    fireEvent.change(source(), { target: { value: text.replace('Alpha', 'Typed') } })
    expect(screen.getByTestId('map-labels').textContent).toContain('Typed')
    expect(screen.getByRole('button', { name: 'Focus Typed' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy full route route-1.wpt' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(source().value))
    fireEvent.click(screen.getByRole('button', { name: 'Rename on map' }))
    expect(source().value).toContain('MapRenamed')
    expect(source().value).toContain('BROKEN')
    fireEvent.click(screen.getByRole('button', { name: 'Reverse order' }))
    expect(source().value).toContain('BROKEN')
    expect(screen.getByTestId('map-labels').textContent).toBe('Beta,MapRenamed')
  })

  it('offers independent names and requires confirmation before harmonizing existing routes', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    const mode = screen.getByRole('combobox', { name: 'Names at shared coordinates' })
    expect((mode as HTMLSelectElement).value).toBe('shared')
    fireEvent.change(mode, { target: { value: 'independent' } })
    addRoute()
    addRoute(text.replace('Alpha', 'Other'))
    fireEvent.click(screen.getByRole('button', { name: /^route-1.wpt/ }))
    fireEvent.change(source(), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: /^route-2.wpt/ }))
    fireEvent.change(mode, { target: { value: 'shared' } })
    expect(window.confirm).toHaveBeenCalledOnce()
    expect((mode as HTMLSelectElement).value).toBe('independent')
    expect(source().value).toContain('Other')
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.change(mode, { target: { value: 'shared' } })
    expect((mode as HTMLSelectElement).value).toBe('shared')
    expect(source().value).toContain('Alpha')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((mode as HTMLSelectElement).value).toBe('independent')
    expect(source().value).toContain('Other')
  })

  it('shows clipboard failures', async () => {
    writeText.mockRejectedValue(new DOMException('Clipboard denied'))
    render(<App />)
    addRoute()
    fireEvent.click(screen.getByRole('button', { name: 'Copy full route route-1.wpt' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Clipboard denied'))
  })

  it('surfaces file-write failures and keeps the route unsaved', async () => {
    pickerWindow.showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockRejectedValue(new Error('Disk full')),
    })
    render(<App />)
    addRoute()
    fireEvent.click(screen.getByRole('button', { name: 'Save route route-1.wpt to file' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Disk full'))
    expect(screen.getByText('route-1.wpt (unsaved)')).toBeTruthy()
  })

  it('saves the exact captured source and keeps edits during a save dirty', async () => {
    let complete: () => void = () => { throw new Error('Save did not start') }
    const pending = new Promise<void>((resolve) => { complete = resolve })
    const write = vi.fn().mockResolvedValue(undefined)
    pickerWindow.showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close: () => pending, abort: vi.fn() }),
    })
    render(<App />)
    addRoute()
    const save = screen.getByRole('button', { name: 'Save route route-1.wpt to file' }) as HTMLButtonElement
    fireEvent.click(save)
    await waitFor(() => expect(write).toHaveBeenCalledWith(text))
    expect(save.disabled).toBe(true)
    fireEvent.change(source(), { target: { value: text.replace('Alpha', 'Newer') } })
    complete()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'))
    expect(screen.getByText('route-1.wpt (unsaved)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('route-1.wpt')).toBeTruthy()
  })

  it('restores the file handle after undoing a route removal', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const write = vi.fn().mockResolvedValue(undefined)
    pickerWindow.showSaveFilePicker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close: vi.fn(), abort: vi.fn() }),
    })
    render(<App />)
    addRoute()
    fireEvent.click(screen.getByRole('button', { name: 'Save route route-1.wpt to file' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove route route-1.wpt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save route route-1.wpt to file' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(pickerWindow.showSaveFilePicker).toHaveBeenCalledOnce()
  })
})
