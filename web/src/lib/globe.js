const rad = Math.PI / 180
const vector = ([lon, lat]) => [Math.cos(lat * rad) * Math.cos(lon * rad), Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)]
export function project([lon, lat], rotation = -25, radius = 150) {
  const lambda = (lon - rotation) * rad, phi = lat * rad, tilt = 15 * rad
  const x = Math.cos(phi) * Math.sin(lambda)
  const y = Math.sin(phi) * Math.cos(tilt) - Math.cos(phi) * Math.cos(lambda) * Math.sin(tilt)
  const depth = Math.sin(phi) * Math.sin(tilt) + Math.cos(phi) * Math.cos(lambda) * Math.cos(tilt)
  return { x: 200 + radius * x, y: 180 - radius * y, visible: depth > 0.02 }
}
export function linePath(points, rotation) {
  let path = '', open = false
  for (const point of points) {
    const p = project(point, rotation)
    if (!p.visible) { open = false; continue }
    path += `${open ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`
    open = true
  }
  return path
}
export function arcPath(from, to, rotation = -25) {
  const a = vector(from), b = vector(to)
  const angle = Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i], 0))))
  if (angle < 0.001) return ''
  // An antipodal pair has no unique great circle; choose a stable midpoint.
  if (Math.PI - angle < 0.001) {
    const middle = [from[0] + 90, 0]
    return arcPath(from, middle, rotation) + arcPath(middle, to, rotation)
  }
  let path = '', open = false
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    const v = a.map((value, j) => (Math.sin((1 - t) * angle) * value + Math.sin(t * angle) * b[j]) / Math.sin(angle))
    const position = [Math.atan2(v[1], v[0]) / rad, Math.asin(Math.max(-1, Math.min(1, v[2]))) / rad]
    const p = project(position, rotation, 150 + Math.sin(Math.PI * t) * 30)
    if (!p.visible) { open = false; continue }
    path += `${open ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`
    open = true
  }
  return path
}
