import type { LandscapeGeometry } from '../lib/landscape-geometry.js'
import './landscape-bridge.css'

export function LandscapeBridge({ geometry, visible, paused }: {
  geometry: LandscapeGeometry; visible: boolean; paused: boolean
}) {
  return (
    <div aria-hidden="true" className="ie-landscape-bridge" data-visible={visible} data-paused={paused}
      style={{ width: geometry.width, height: geometry.height, left: geometry.left, top: geometry.top }}>
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <path className="ie-bridge-path" pathLength="1000" d="M220 740 C390 850 590 610 780 700" vectorEffect="non-scaling-stroke" />
        <circle className="ie-bridge-signal" r="3" />
      </svg>
      <span className="ie-bridge-bank ie-bridge-bank-use"><svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="12" rx="1"/><path d="M1 20h22M9 15v5m6-5v5"/></svg>Use AI</span>
      <span className="ie-bridge-bank ie-bridge-bank-provide"><svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M8 1v4m8-4v4M8 19v4m8-4v4M1 8h4m-4 8h4m14-8h4m-4 8h4"/></svg>Provide compute</span>
    </div>
  )
}
