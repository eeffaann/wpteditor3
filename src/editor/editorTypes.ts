export type EditorLayout = 'wide' | 'stacked'

export type Waypoint = {
  id: string
  label: string
  altLabels: string[]
  lat: number
  lon: number
  hidden: boolean
  url: string
}

export type ParseIssue = {
  lineNumber: number
  message: string
  content: string
}

export type ParsedRoute = {
  waypoints: Waypoint[]
  issues: ParseIssue[]
}

export type EditorSnapshot = {
  inputText: string
  waypoints: Waypoint[]
  issues: ParseIssue[]
  loadedLabelSet: string[]
}

export type EditorState = {
  inputText: string
  inUseLabelText: string
  waypoints: Waypoint[]
  issues: ParseIssue[]
  loadedLabelSet: string[]
  layout: EditorLayout
  thicknessStep: number
  fitRequest: number
  history: EditorSnapshot[]
}

export type EditorAction =
  | { type: 'input/set'; value: string }
  | { type: 'labels/input-set'; value: string }
  | { type: 'route/load'; fitToRoute: boolean; route: ParsedRoute }
  | { type: 'route/insert'; lat: number; lon: number; hidden: boolean }
  | { type: 'route/rename-waypoint'; waypointId: string; nextLabel: string }
  | { type: 'route/set-alt-labels'; waypointId: string; altLabels: string[] }
  | { type: 'route/toggle-waypoint-kind'; waypointId: string }
  | { type: 'route/update-waypoint-position'; waypointId: string; lat: number; lon: number }
  | { type: 'route/delete-waypoint'; waypointId: string }
  | { type: 'route/move-waypoint'; fromIndex: number; toIndex: number }
  | { type: 'route/reverse' }
  | { type: 'route/clear' }
  | { type: 'history/undo' }
  | { type: 'layout/toggle' }
  | { type: 'thickness/set'; value: number }
  | { type: 'labels/load' }
  | { type: 'labels/clear' }

export const THICKNESS_OPTIONS = [
  { label: 'Th. -2', value: -2, multiplier: 0.25 },
  { label: 'Th. -1', value: -1, multiplier: 0.5 },
  { label: 'Th. Hwy.', value: 0, multiplier: 1 },
  { label: 'Th. +1', value: 1, multiplier: 2 },
  { label: 'Th. +2', value: 2, multiplier: 4 },
  { label: 'Th. +3', value: 3, multiplier: 8 },
  { label: 'Th. +4', value: 4, multiplier: 16 },
  { label: 'Th. +5', value: 5, multiplier: 32 },
] as const
