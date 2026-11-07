import { bridgeMotionPath, type LandscapeGeometry } from '../lib/landscape-geometry.js'
import { BridgeNavigation } from './BridgeNavigation'
import './landscape-bridge.css'

export function LandscapeBridge({ geometry, visible, reducedMotion }: {
  geometry: LandscapeGeometry; visible: boolean; reducedMotion: boolean
}) {
  return (
    <div aria-hidden={!visible || undefined} className="ie-landscape-bridge" data-visible={visible} data-reduced-motion={reducedMotion}
      style={{ width: geometry.width, height: geometry.height, left: geometry.left, top: geometry.top }}>
      <svg aria-hidden="true" viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <path className="ie-bridge-path" pathLength="1000" d={bridgeMotionPath(1000, 1000)} vectorEffect="non-scaling-stroke" />
      </svg>
      {!reducedMotion && <span aria-hidden="true" className="ie-bridge-signal" style={{ offsetPath: `path("${bridgeMotionPath(geometry.width, geometry.height)}")` }} />}
      <BridgeNavigation visible={visible} />
    </div>
  )
}
