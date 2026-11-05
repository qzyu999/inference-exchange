// Calibrated from the existing landscape: the summit is 6px left of center
// in the 960px reference frame. Keep the optical alignment in source space.
export const SUMMIT_X = 0.5 - 6 / 960

export function landscapeGeometry(width, height, aspect) {
  if (![width, height, aspect].every(value => Number.isFinite(value) && value > 0)) {
    return { width: 0, height: 0, left: 0, top: 0, axisOffset: 0 }
  }
  const imageWidth = Math.max(width, height * aspect)
  const imageHeight = imageWidth / aspect
  return {
    width: imageWidth,
    height: imageHeight,
    left: (width - imageWidth) / 2,
    top: (height - imageHeight) / 2,
    axisOffset: (SUMMIT_X - 0.5) * imageWidth,
  }
}

// Use the same normalized curve for the SVG line and the unscaled HTML marker.
export function bridgeMotionPath(width, height) {
  return `M${0.22 * width} ${0.74 * height} C${0.39 * width} ${0.85 * height} ${0.59 * width} ${0.61 * height} ${0.78 * width} ${0.7 * height}`
}
