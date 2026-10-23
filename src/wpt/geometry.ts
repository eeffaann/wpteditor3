export function toCoordinateKey(lat: number, lon: number) {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`
}

export function sameCoordinate(lat1: number, lon1: number, lat2: number, lon2: number) {
  return toCoordinateKey(lat1, lon1) === toCoordinateKey(lat2, lon2)
}

export function toMercatorPoint(lat: number, lon: number) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  return {
    x: lon / 360 + 0.5,
    y: 0.5 * Math.log(Math.tan(Math.PI / 4 - (Math.PI / 360) * clampedLat)) / Math.PI + 0.5,
  }
}

export function mileage(lat1: number, lon1: number, lat2: number, lon2: number) {
  if (lat1 === lat2 && lon1 === lon2) return 0
  const radians = Math.PI / 180
  const angle =
    Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.cos((lon1 - lon2) * radians) +
    Math.sin(lat1 * radians) * Math.sin(lat2 * radians)
  return Math.acos(Math.min(1, Math.max(-1, angle))) * 1.02112 * 3963
}
