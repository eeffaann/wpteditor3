import { describe, expect, it, vi } from 'vitest'
import { writeRouteFile, type RouteFileHandle } from './routeFiles'

function fixture() {
  const stream = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) }
  const handle: RouteFileHandle = {
    kind: 'file', name: 'one.wpt', getFile: vi.fn(),
    createWritable: vi.fn().mockResolvedValue(stream),
  }
  return { stream, handle }
}

describe('file writes', () => {
  it('writes exact source bytes and waits for close', async () => {
    const { stream, handle } = fixture()
    await writeRouteFile(handle, 'BROKEN\r\n')
    expect(stream.write).toHaveBeenCalledWith('BROKEN\r\n')
    expect(stream.close).toHaveBeenCalledOnce()
    expect(stream.abort).not.toHaveBeenCalled()
  })

  it.each(['write', 'close'] as const)('aborts and surfaces %s failures', async (operation) => {
    const { stream, handle } = fixture()
    const error = new Error('Disk full')
    stream[operation].mockRejectedValue(error)
    await expect(writeRouteFile(handle, 'source')).rejects.toBe(error)
    expect(stream.abort).toHaveBeenCalledOnce()
  })

  it('surfaces permission failures before stream creation', async () => {
    const { stream, handle } = fixture()
    vi.mocked(handle.createWritable).mockRejectedValue(new Error('Permission denied'))
    await expect(writeRouteFile(handle, 'source')).rejects.toThrow('Permission denied')
    expect(stream.write).not.toHaveBeenCalled()
  })

  it('reports both the original error and abort failure', async () => {
    const { stream, handle } = fixture()
    stream.write.mockRejectedValue(new Error('Disk full'))
    stream.abort.mockRejectedValue(new Error('Abort failed'))
    await expect(writeRouteFile(handle, 'source')).rejects.toBeInstanceOf(AggregateError)
  })
})
