import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'

// ─── Colors ──────────────────────────────────────────────────
const AMBER = 0xb9473c
const EMERALD = 0x4b9563
const BG = 0x08080c

// ─── Stella Octangula from cube vertices ─────────────────────
//
// The mathematically exact construction: pick alternating vertices
// of a cube to get two dual regular tetrahedra. When superimposed
// at the origin they form the stella octangula.
//
// We then rotate the ENTIRE compound so that one vertex of the
// up-tetra sits at the very top (+Y) and one vertex of the
// down-tetra sits at the very bottom (-Y). This gives the
// clean up-arrow / down-arrow silhouette while keeping the
// perfect stella octangula geometry.

const S = 1.3

// Raw cube-vertex tetrahedra (before alignment rotation)
const RAW_UP = [
  [+S, +S, +S],
  [+S, -S, -S],
  [-S, +S, -S],
  [-S, -S, +S],
]

const RAW_DOWN = [
  [+S, +S, -S],
  [+S, -S, +S],
  [-S, +S, +S],
  [-S, -S, -S],
]

// Rotation to align: we want RAW_UP[0] = (S,S,S) to point straight up (+Y).
// The direction of (1,1,1) normalized is our current "up vertex" direction.
// We need a rotation that maps (1,1,1)/sqrt(3) -> (0,1,0).
function alignRotation(): THREE.Matrix4 {
  const from = new THREE.Vector3(1, 1, 1).normalize()
  const to = new THREE.Vector3(0, 1, 0)
  const q = new THREE.Quaternion().setFromUnitVectors(from, to)
  return new THREE.Matrix4().makeRotationFromQuaternion(q)
}

const ALIGN = alignRotation()

function applyAlign(raw: number[][]): THREE.Vector3[] {
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(ALIGN))
}

const VERTS_UP = applyAlign(RAW_UP)
const VERTS_DOWN = applyAlign(RAW_DOWN)

// ─── Geometry builder with correct outward winding ───────────

function makeTetraGeo(v: THREE.Vector3[]): THREE.BufferGeometry {
  const positions = new Float32Array([
    v[0].x, v[0].y, v[0].z,
    v[1].x, v[1].y, v[1].z,
    v[2].x, v[2].y, v[2].z,
    v[3].x, v[3].y, v[3].z,
  ])

  // Build 4 faces with correct outward normals
  const indices: number[] = []
  const faces = [
    [0, 1, 2, 3],
    [0, 1, 3, 2],
    [0, 2, 3, 1],
    [1, 2, 3, 0],
  ]
  for (const [a, b, c, opp] of faces) {
    const ab = new THREE.Vector3().subVectors(v[b], v[a])
    const ac = new THREE.Vector3().subVectors(v[c], v[a])
    const normal = new THREE.Vector3().crossVectors(ab, ac)
    const toOpp = new THREE.Vector3().subVectors(v[opp], v[a])
    if (normal.dot(toOpp) > 0) {
      indices.push(a, c, b) // flip
    } else {
      indices.push(a, b, c)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// ─── Tetrahedron mesh group ──────────────────────────────────

function makeTetra(color: number, verts: THREE.Vector3[], renderOrder: number): THREE.Group {
  const group = new THREE.Group()
  const geo = makeTetraGeo(verts)

  // Translucent faces
  const faceMesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
    shininess: 80,
    specular: 0x666666,
  }))
  faceMesh.renderOrder = renderOrder
  group.add(faceMesh)

  // Bright edges
  const edgeMesh = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })
  )
  edgeMesh.renderOrder = renderOrder + 0.5
  group.add(edgeMesh)

  return group
}

// ─── Intersection octahedron wireframe ───────────────────────
//
// The stella octangula's two tetrahedra intersect along the edges
// of a regular octahedron. Its 6 vertices are the edge-midpoints
// of either tetrahedron. We compute them and draw the 12 edges.

function makeOctahedronWireframe(): THREE.LineSegments {
  // The octahedron vertices are midpoints of the 6 edges of tetra A.
  // A tetrahedron has 4 vertices → C(4,2) = 6 edges → 6 midpoints.
  const midpoints: THREE.Vector3[] = []
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      midpoints.push(
        new THREE.Vector3().addVectors(VERTS_UP[i], VERTS_UP[j]).multiplyScalar(0.5)
      )
    }
  }
  // midpoints order: (0,1),(0,2),(0,3),(1,2),(1,3),(2,3) → 6 vertices

  // A regular octahedron has 12 edges. Each vertex connects to 4 others
  // (all except its opposite). Find the edge pairs: two vertices are
  // connected if their distance equals the octahedron edge length
  // (NOT the longest diagonal).
  const edgePairs: [number, number][] = []
  const dists: number[] = []
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      dists.push(midpoints[i].distanceTo(midpoints[j]))
    }
  }
  // The shortest distance among midpoints is the edge length.
  // The longest is the diagonal (opposite vertices).
  const minDist = Math.min(...dists)
  const edgeThreshold = minDist * 1.1 // small tolerance

  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      if (midpoints[i].distanceTo(midpoints[j]) < edgeThreshold) {
        edgePairs.push([i, j])
      }
    }
  }

  // Build line geometry
  const positions = new Float32Array(edgePairs.length * 6)
  for (let k = 0; k < edgePairs.length; k++) {
    const [i, j] = edgePairs[k]
    positions[k * 6 + 0] = midpoints[i].x
    positions[k * 6 + 1] = midpoints[i].y
    positions[k * 6 + 2] = midpoints[i].z
    positions[k * 6 + 3] = midpoints[j].x
    positions[k * 6 + 4] = midpoints[j].y
    positions[k * 6 + 5] = midpoints[j].z
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })

  return new THREE.LineSegments(geo, mat)
}

// ─── Particles ───────────────────────────────────────────────

function makeDust(count: number): { points: THREE.Points; speeds: Float32Array } {
  const pos = new Float32Array(count * 3)
  const speeds = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 18
    pos[i * 3 + 1] = (Math.random() - 0.5) * 18
    pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 3
    speeds[i] = 0.002 + Math.random() * 0.005
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.03, transparent: true, opacity: 0.3,
    sizeAttenuation: true, depthWrite: false,
  })
  return { points: new THREE.Points(geo, mat), speeds }
}

interface OrbitData {
  points: THREE.Points
  phase: Float32Array
  radii: Float32Array
  speeds: Float32Array
  yBase: Float32Array
}

function makeOrbit(count: number): OrbitData {
  const pos = new Float32Array(count * 3)
  const phase = new Float32Array(count)
  const radii = new Float32Array(count)
  const speeds = new Float32Array(count)
  const yBase = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    phase[i] = Math.random() * Math.PI * 2
    radii[i] = 2.8 + Math.random() * 1.0
    speeds[i] = (0.2 + Math.random() * 0.3) * (Math.random() > 0.5 ? 1 : -1)
    yBase[i] = (Math.random() - 0.5) * 2.2
    pos[i * 3] = Math.cos(phase[i]) * radii[i]
    pos[i * 3 + 1] = yBase[i]
    pos[i * 3 + 2] = Math.sin(phase[i]) * radii[i]
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.04, transparent: true, opacity: 0,
    sizeAttenuation: true, depthWrite: false,
  })
  return { points: new THREE.Points(geo, mat), phase, radii, speeds, yBase }
}

// ─── Sun and Moon ────────────────────────────────────────────

function makeSun(): THREE.Group {
  const group = new THREE.Group()

  // Flat circle — always screen-parallel via quaternion copy
  const r = 0.14
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(r, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd666, side: THREE.DoubleSide })
  )
  group.add(core)

  // Glow halo — flat circle
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(r * 2, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffd666,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  )
  group.add(halo)

  group.visible = false
  return group
}

function makeMoon(): THREE.Group {
  const group = new THREE.Group()

  // White disc + same-size dark disc shifted LEFT = crescent on the RIGHT (facing sun)
  const r = 0.14 // match sun core size roughly

  // White moon disc
  const moonGeo = new THREE.CircleGeometry(r, 48)
  const moonMat = new THREE.MeshBasicMaterial({
    color: 0xd4dff0,
    side: THREE.DoubleSide,
  })
  group.add(new THREE.Mesh(moonGeo, moonMat))

  // Dark mask — same radius, shifted LEFT to expose crescent on the right
  const maskGeo = new THREE.CircleGeometry(r, 48)
  const maskMat = new THREE.MeshBasicMaterial({
    color: BG,
    side: THREE.DoubleSide,
  })
  const mask = new THREE.Mesh(maskGeo, maskMat)
  mask.position.x = -0.09 // shift left — crescent visible on right side, facing sun
  mask.position.z = 0.001
  group.add(mask)

  group.visible = false
  return group
}

// ─── Easing ──────────────────────────────────────────────────

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3)
}
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

// ─── Scene state ─────────────────────────────────────────────

interface SceneState {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  pivot: THREE.Group
  upTetra: THREE.Group
  downTetra: THREE.Group
  octaWire: THREE.LineSegments
  sun: THREE.Group
  moon: THREE.Group
  dust: { points: THREE.Points; speeds: Float32Array }
  orbit: OrbitData
  frame: number
  time: number
}

// ─── Component ───────────────────────────────────────────────

interface HeroSceneProps {
  scrollProgress: number
  onInitFailed?: () => void
}

export function HeroScene({ scrollProgress, onInitFailed }: HeroSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const progressRef = useRef(0)
  progressRef.current = scrollProgress

  const init = useCallback(() => {
    const el = containerRef.current
    if (!el || stateRef.current) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (w === 0 || h === 0) return

    // Check WebGL availability
    const testCanvas = document.createElement('canvas')
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl')
    if (!gl) {
      console.warn('HeroScene: WebGL not available')
      onInitFailed?.()
      return
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(BG)

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
    camera.position.set(0, 1.5, 9)
    camera.lookAt(0, 0, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch (e) {
      console.warn('HeroScene: WebGLRenderer creation failed:', e)
      onInitFailed?.()
      return
    }
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.0)
    key.position.set(3, 5, 5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x6688cc, 0.3)
    fill.position.set(-4, -2, 3)
    scene.add(fill)

    // Pivot — unified slow rotation
    const pivot = new THREE.Group()
    scene.add(pivot)

    // Green (emerald) = up-pointing tetra, starts at bottom, rises
    // Amber = down-pointing tetra, starts at top, drops
    // Emerald renders first (behind), amber on top — consistent interior color
    const upTetra = makeTetra(EMERALD, VERTS_UP, 1)
    const downTetra = makeTetra(AMBER, VERTS_DOWN, 2)
    pivot.add(upTetra)
    pivot.add(downTetra)

    const octaWire = makeOctahedronWireframe()
    pivot.add(octaWire)

    const sun = makeSun()
    const moon = makeMoon()
    scene.add(sun)
    scene.add(moon)

    const dust = makeDust(100)
    scene.add(dust.points)

    const orbit = makeOrbit(60)
    pivot.add(orbit.points)

    stateRef.current = {
      renderer, scene, camera, pivot,
      upTetra, downTetra, octaWire, sun, moon, dust, orbit,
      frame: 0, time: 0,
    }
    console.log(`HeroScene: initialized (${w}x${h}, dpr=${renderer.getPixelRatio()})`)
  }, [])

  const animate = useCallback(() => {
    const s = stateRef.current
    if (!s) return
    s.frame = requestAnimationFrame(animate)

    s.time += 0.016
    const t = s.time
    const p = progressRef.current

    // ── Act 1: merge along Y (0 → 0.35) ────────────────────
    const merge = easeInOutCubic(clamp01(p / 0.35))
    const sep = 4.0 * (1 - merge)
    // Up-tetra (green) starts below, rises to origin
    // Down-tetra (amber) starts above, drops to origin
    s.upTetra.position.y = -sep
    s.downTetra.position.y = sep

    // Slow Y rotation
    s.pivot.rotation.y = t * 0.15

    // Opacity
    const fO = 0.12 + merge * 0.18
    const eO = 0.7 + merge * 0.25

    const uFace = (s.upTetra.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial
    const dFace = (s.downTetra.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial
    const uEdge = (s.upTetra.children[1] as THREE.LineSegments).material as THREE.LineBasicMaterial
    const dEdge = (s.downTetra.children[1] as THREE.LineSegments).material as THREE.LineBasicMaterial

    uFace.opacity = fO
    dFace.opacity = fO
    uEdge.opacity = eO
    dEdge.opacity = eO

    // Breathe when merged
    const breathe = merge > 0.95 ? 1 + Math.sin(t * 2) * 0.015 : 1
    s.upTetra.scale.setScalar(breathe)
    s.downTetra.scale.setScalar(breathe)

    // Intersection octahedron wireframe fades in with merge
    const octaMat = s.octaWire.material as THREE.LineBasicMaterial
    octaMat.opacity = merge * 0.5

    // ── Act 2: orbit particles + sun/moon (0.30 → 0.55) ────
    const orbitFade = clamp01((p - 0.30) / 0.25)
    const oMat = s.orbit.points.material as THREE.PointsMaterial
    oMat.opacity = orbitFade * 0.5

    // Sun: static top-right, screen-parallel
    s.sun.visible = orbitFade > 0.01
    s.sun.position.set(3.2, 2.2, -1)
    s.sun.quaternion.copy(s.camera.quaternion)

    // Moon: static top-left, same height as sun
    s.moon.visible = orbitFade > 0.01
    s.moon.position.set(-3.2, 2.2, -1)
    s.moon.quaternion.copy(s.camera.quaternion)

    const oPos = s.orbit.points.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < s.orbit.phase.length; i++) {
      s.orbit.phase[i] += s.orbit.speeds[i] * 0.016
      oPos.array[i * 3] = Math.cos(s.orbit.phase[i]) * s.orbit.radii[i]
      oPos.array[i * 3 + 1] = s.orbit.yBase[i] + Math.sin(t * 0.4 + i) * 0.2
      oPos.array[i * 3 + 2] = Math.sin(s.orbit.phase[i]) * s.orbit.radii[i]
    }
    oPos.needsUpdate = true

    // ── Act 3: camera pull-back (0.55 → 0.85) ──────────────
    const pull = easeOutCubic(clamp01((p - 0.55) / 0.3))
    s.camera.position.z = 9 + pull * 2.5
    s.camera.position.y = 1.5 + pull * 0.5
    s.camera.lookAt(0, 0, 0)

    // ── Act 4: fade to page bg (0.85 → 1.0) ────────────────
    const fade = clamp01((p - 0.85) / 0.15)
    const inv = 1 - fade

    uFace.opacity = fO * inv
    dFace.opacity = fO * inv
    uEdge.opacity = eO * inv
    dEdge.opacity = eO * inv
    oMat.opacity = orbitFade * 0.5 * inv
    octaMat.opacity = merge * 0.5 * inv

    // Hide sun/moon during fadeout
    if (fade > 0.5) {
      s.sun.visible = false
      s.moon.visible = false
    }

    s.scene.background = new THREE.Color(BG).lerp(new THREE.Color(0xfafafa), fade)

    // Dust
    const dPos = s.dust.points.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < s.dust.speeds.length; i++) {
      dPos.array[i * 3 + 1] += s.dust.speeds[i]
      if (dPos.array[i * 3 + 1] > 9) dPos.array[i * 3 + 1] = -9
    }
    dPos.needsUpdate = true
    ;(s.dust.points.material as THREE.PointsMaterial).opacity = 0.25 * inv

    s.renderer.render(s.scene, s.camera)
  }, [])

  useEffect(() => {
    let retries = 0
    const maxRetries = 10
    let initTimerId: ReturnType<typeof setTimeout> | null = null

    const tryInit = () => {
      if (stateRef.current) return
      init()
      // Re-read after init (TS can't track ref mutation through useCallback)
      const s = stateRef.current as SceneState | null
      if (s) {
        s.frame = requestAnimationFrame(animate)
      } else if (retries < maxRetries) {
        retries++
        initTimerId = setTimeout(tryInit, 50 * Math.pow(2, retries - 1))
      } else {
        console.warn('HeroScene: failed to init after retries')
        onInitFailed?.()
      }
    }
    requestAnimationFrame(tryInit)

    const onResize = () => {
      const el = containerRef.current
      const s = stateRef.current
      if (!el || !s) return
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === 0 || h === 0) return
      s.renderer.setSize(w, h)
      s.camera.aspect = w / h
      s.camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      if (initTimerId) clearTimeout(initTimerId)
      window.removeEventListener('resize', onResize)
      const s = stateRef.current
      if (s) {
        cancelAnimationFrame(s.frame)
        s.renderer.dispose()
        if (containerRef.current) {
          try { containerRef.current.removeChild(s.renderer.domElement) } catch (_) {}
        }
        stateRef.current = null
      }
    }
  }, [init, animate])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ width: '100%', height: '100%' }}
    />
  )
}
