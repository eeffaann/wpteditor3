export type WritableRouteFile = {
  write: (data: string) => Promise<void>
  close: () => Promise<void>
  abort: () => Promise<void>
}

export type RouteFileHandle = {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<WritableRouteFile>
}

export type RouteDirectoryHandle = {
  kind: 'directory'
  name: string
  values: () => AsyncIterable<RouteFileHandle | RouteDirectoryHandle>
}

export type RoutePickerWindow = Window & {
  showDirectoryPicker?: () => Promise<RouteDirectoryHandle>
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<RouteFileHandle>
}

export async function collectWptFileHandles(
  directory: RouteDirectoryHandle,
  prefix = '',
): Promise<Array<{ relativePath: string; handle: RouteFileHandle }>> {
  const routes: Array<{ relativePath: string; handle: RouteFileHandle }> = []
  for await (const entry of directory.values()) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.wpt')) {
      routes.push({ relativePath, handle: entry })
    } else if (entry.kind === 'directory') {
      routes.push(...await collectWptFileHandles(entry, relativePath))
    }
  }
  return routes.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export async function writeRouteFile(handle: RouteFileHandle, text: string) {
  const writable = await handle.createWritable()
  try {
    await writable.write(text)
    await writable.close()
  } catch (error) {
    try {
      await writable.abort()
    } catch (abortError) {
      throw new AggregateError([error, abortError], 'Saving failed and the writable stream could not be aborted.')
    }
    throw error
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
