import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'

import { GL } from '../lib/theme'

// ─── Mineral spectrum ────────────────────────────────────────
// The red and green tetrahedra remain the poles of the mark.
// The intersection is allowed to travel through the full mineral spectrum.
const MINERAL_COLORS = [
  new THREE.Color(0xC83A32), // red / demand
  new THREE.Color(0xD77A2F), // orange / computation
  new THREE.Color(0xC49A45), // gold / value
  new THREE.Color(0x087F5B), // green / supply
  new THREE.Color(0x4D9A91), // turquoise / intersection
  new THREE.Color(0x315B72), // blue / trust
  new THREE.Color(0x4A465F), // indigo / observability
  new THREE.Color(0x702F32), // maroon / resolution
]

function mineralAt(t: number): THREE.Color {
  const p = ((t % 1) + 1) % 1
  const scaled = p * (MINERAL_COLORS.length - 1)
  const i = Math.floor(scaled)
  return MINERAL_COLORS[i].clone().lerp(
    MINERAL_COLORS[Math.min(i + 1, MINERAL_COLORS.length - 1)],
    scaled - i
  )
}

const RED = 0xC83A32
const EMERALD = GL.emerald
const BG = GL.bg

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

// Shared, deterministic erosion profile for the solid faces AND grains.
// Left edge releases first, with an uneven wave along the vertical axis.
function erosionThresholdAt(x: number, y: number): number {
  const t = Math.max(0, Math.min(1, (x + 2.2) / 4.4))
  const sweep = t * t * (3 - 2 * t)
  const n = Math.sin(x * 17.1 + y * 23.37) * 43758.5453
  const grain = n - Math.floor(n)
  return 0.07 + 0.65 * sweep + 0.07 * Math.sin((y + 2.2) * 1.7) + 0.04 * (grain - 0.5)
}

function addErosionToSurface(
  material: THREE.MeshPhongMaterial | THREE.LineBasicMaterial,
  erosion: { value: number },
) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uErosion = erosion
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vErosionPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvErosionPosition = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uErosion;
        varying vec3 vErosionPosition;
        float erosionThreshold(vec2 p) {
          float sweep = smoothstep(-2.2, 2.2, p.x);
          float n = fract(sin(dot(p, vec2(17.1, 23.37))) * 43758.5453);
          return 0.07 + 0.65 * sweep + 0.07 * sin((p.y + 2.2) * 1.7)
                 + 0.04 * (n - 0.5);
        }
      `)
      .replace('#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        // Grains lift first, then the corresponding face fragments disappear.
        if (uErosion > erosionThreshold(vErosionPosition.xy) + 0.11) discard;
        `)
  }
}

// ─── Tetrahedron mesh group ──────────────────────────────────

function makeTetra(
  color: number,
  verts: THREE.Vector3[],
  renderOrder: number,
  erosion: { value: number },
): THREE.Group {
  const group = new THREE.Group()
  const geo = makeTetraGeo(verts)

  // The intact faces are eroded by the SAME spatial wind profile that
  // releases the grains. A global opacity fade looked like a vanishing mesh.
  const faceMaterial = new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
    shininess: 80,
    specular: 0x666666,
  })
  addErosionToSurface(faceMaterial, erosion)
  const faceMesh = new THREE.Mesh(geo, faceMaterial)
  faceMesh.renderOrder = renderOrder
  group.add(faceMesh)

  // The bright edges must erode with the faces. Otherwise the faces
  // disappear but a complete tetrahedron outline remains over the sand,
  // which looks like a simple fade rather than material breaking apart.
  const edgeMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
  })
  addErosionToSurface(edgeMaterial, erosion)
  const edgeMesh = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMaterial)
  edgeMesh.renderOrder = renderOrder + 0.5
  group.add(edgeMesh)

  return group
}

// ─── Intersection octahedron wireframe ───────────────────────
//
// The stella octangula's two tetrahedra intersect along the edges
// of a regular octahedron. Its 6 vertices are the edge-midpoints
// of either tetrahedron. We compute them and draw the 12 edges.

function makeOctahedronWireframe(erosion: { value: number }): THREE.LineSegments {
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
    color: GL.chryso,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  // The inner octahedron must fragment under the same erosion front as
  // both outer tetrahedrons—not just fade while their grains blow away.
  addErosionToSurface(mat, erosion)

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
    color: GL.warmWhite, size: 0.03, transparent: true, opacity: 0.3,
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
    color: GL.warmWhite, size: 0.04, transparent: true, opacity: 0,
    sizeAttenuation: true, depthWrite: false,
  })
  return { points: new THREE.Points(geo, mat), phase, radii, speeds, yBase }
}

// ─── Mineral-grain dissolution ───────────────────────────────
// Sample the actual tetrahedron faces with deterministic barycentric points.
// A small GPU shader carries these grains outward on a scroll-controlled
// current; reversing the scroll reconstructs the same exact geometry.
// No copied iconography, no random frame-to-frame forces, no extra renderer.

function makeMineralGrains(octaWire: THREE.LineSegments): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  // Keep the existing particle budget. Reserve ~12% for the third, inner
  // octahedron: these grains come from its ACTUAL wireframe segments.
  const count = window.innerWidth < 768 ? 8500 : 30000
  const octaCount = window.innerWidth < 768 ? 1000 : 3600
  const faceCount = count - octaCount
  const octaPositions = octaWire.geometry.getAttribute('position') as THREE.BufferAttribute
  const octaEdges = octaPositions.count / 2
  const positions = new Float32Array(count * 3)
  const pigments = new Float32Array(count * 3)
  const drifts = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const releaseTimes = new Float32Array(count)

  const faces = [
    [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3],
  ]
  const accents = [
    0xC83A32, 0xD77A2F, 0xC49A45, 0x087F5B,
    0x4D9A91, 0x315B72, 0x4A465F, 0x702F32,
  ]
  // The inner intersection already cycles through the mineral spectrum.
  // Favor luminous turquoise and sapphire, with occasional gold/indigo.
  const intersectionAccents = [0x4D9A91, 0x315B72, 0xC49A45, 0x4A465F]
  const pale = new THREE.Color()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let state = 0x19A7E31
  const rand = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    if (i < faceCount) {
      const green = i % 2 === 0
      const verts = green ? VERTS_UP : VERTS_DOWN
      const face = faces[Math.floor(rand() * 4)]
      a.copy(verts[face[0]])
      b.copy(verts[face[1]])
      c.copy(verts[face[2]])

      // Square-root barycentric sampling gives constant area density.
      const u = Math.sqrt(rand())
      const v = rand()
      positions[i3] = a.x * (1 - u) + b.x * (u * (1 - v)) + c.x * u * v
      positions[i3 + 1] = a.y * (1 - u) + b.y * (u * (1 - v)) + c.y * u * v
      positions[i3 + 2] = a.z * (1 - u) + b.z * (u * (1 - v)) + c.z * u * v

      // Preserve recognizable red/green poles with mineral accents.
      pale.setHex(accents[Math.floor(rand() * accents.length)])
      pale.lerp(new THREE.Color(green ? EMERALD : RED), 0.54)
    } else {
      // Sample points directly along each of the twelve REAL octahedron
      // edges. Cycling the edges spreads the third shape's grains evenly;
      // sampling the same BufferGeometry guarantees exact alignment.
      const edge = (i - faceCount) % octaEdges
      const blend = rand()
      const start = edge * 2
      const end = start + 1
      positions[i3] = octaPositions.getX(start) * (1 - blend) + octaPositions.getX(end) * blend
      positions[i3 + 1] = octaPositions.getY(start) * (1 - blend) + octaPositions.getY(end) * blend
      positions[i3 + 2] = octaPositions.getZ(start) * (1 - blend) + octaPositions.getZ(end) * blend

      pale.setHex(intersectionAccents[Math.floor(rand() * intersectionAccents.length)])
      pale.lerp(MINERAL_COLORS[4], 0.35)
    }

    pigments[i3] = pale.r
    pigments[i3 + 1] = pale.g
    pigments[i3 + 2] = pale.b
    drifts[i3] = rand() * 2 - 1
    drifts[i3 + 1] = rand() * 2 - 1
    drifts[i3 + 2] = rand() * 2 - 1
    seeds[i] = rand()
    releaseTimes[i] = erosionThresholdAt(positions[i3], positions[i3 + 1])
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aPigment', new THREE.BufferAttribute(pigments, 3))
  geo.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 3))
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  geo.setAttribute('aRelease', new THREE.BufferAttribute(releaseTimes, 1))

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uProgress: { value: 0 },
      uDpr: { value: 1 },
    },
    vertexShader: `
      attribute vec3 aPigment;
      attribute vec3 aDrift;
      attribute float aSeed;
      attribute float aRelease;
      uniform float uProgress;
      uniform float uDpr;
      varying vec3 vPigment;
      varying float vAlpha;
      void main() {
        // Grains leave in an uneven left-to-right gust front, derived from
        // exactly the same local-space profile used by the intact faces.
        float age = max(0.0, uProgress - aRelease);
        float lift = smoothstep(0.0, 0.16, age);
        float travel = smoothstep(0.0, 0.57, age);
        vec3 grain = position;

        // Accelerating gust, with small coherent swirls and z-depth.
        // Keep grains on screen long enough to read as an actual smear.
        float wave = sin(travel * 7.0 + position.y * 2.3 + aSeed * 3.0);
        grain.x += (travel * 2.6 + travel * travel * 1.3)
                   * (1.0 + aDrift.x * 0.20);
        grain.y += travel * (aDrift.y * 1.65 + wave * 0.52);
        grain.z += travel * aDrift.z * 0.9;

        vec4 eye = modelViewMatrix * vec4(grain, 1.0);
        gl_Position = projectionMatrix * eye;
        gl_PointSize = clamp(
          uDpr * (2.2 + 2.6 * aSeed) * (9.0 / max(5.0, -eye.z)),
          1.5, 6.0
        );
        vPigment = aPigment;
        // The solid fragment is cut only AFTER its grain has lifted.
        // Maintain a visible plume until the final product is nearly ready.
        vAlpha = lift * (1.0 - smoothstep(0.87, 1.0, uProgress))
                 * (0.73 + aSeed * 0.25);
      }
    `,
    fragmentShader: `
      varying vec3 vPigment;
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - 0.5);
        float grain = 1.0 - smoothstep(0.25, 0.50, radius);
        if (grain < 0.02 || vAlpha < 0.01) discard;
        gl_FragColor = vec4(vPigment, grain * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false // Shader displaces grains beyond CPU bounds.
  points.renderOrder = 6
  return points
}

// ─── Sun and Moon ────────────────────────────────────────────

function makeSun(): THREE.Group {
  const group = new THREE.Group()

  // Flat circle — always screen-parallel via quaternion copy
  const r = 0.14
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(r, 48),
    new THREE.MeshBasicMaterial({ color: GL.gold, side: THREE.DoubleSide })
  )
  group.add(core)

  // Glow halo — flat circle
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(r * 2, 48),
    new THREE.MeshBasicMaterial({
      color: GL.gold,
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
    color: GL.warmWhite,
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
  erosion: { value: number }
  mineralGrains: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
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
  landscapeMode?: boolean
  reducedMotion?: boolean
  onInitFailed?: () => void
}

export function HeroScene({ scrollProgress, landscapeMode = false, reducedMotion = false, onInitFailed }: HeroSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const progressRef = useRef(0)
  progressRef.current = scrollProgress
  const landscapeRef = useRef(landscapeMode)
  const reducedMotionRef = useRef(reducedMotion)
  landscapeRef.current = landscapeMode
  reducedMotionRef.current = reducedMotion

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
    scene.background = landscapeRef.current ? null : new THREE.Color(BG)

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
    camera.position.set(0, 1.5, 9)
    camera.lookAt(0, 0, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch (e) {
      console.warn('HeroScene: WebGLRenderer creation failed:', e)
      onInitFailed?.()
      return
    }
    renderer.setClearColor(0x000000, 0)
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
    // Red = down-pointing tetra, starts at top, drops
    // Emerald renders first (behind), red on top — consistent interior color
    const erosion = { value: 0 }
    const upTetra = makeTetra(EMERALD, VERTS_UP, 1, erosion)
    const downTetra = makeTetra(RED, VERTS_DOWN, 2, erosion)
    pivot.add(upTetra)
    pivot.add(downTetra)

    const octaWire = makeOctahedronWireframe(erosion)
    pivot.add(octaWire)
    const mineralGrains = makeMineralGrains(octaWire)
    mineralGrains.material.uniforms.uDpr.value = renderer.getPixelRatio()
    pivot.add(mineralGrains)

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
      upTetra, downTetra, octaWire, erosion, mineralGrains, sun, moon, dust, orbit,
      frame: 0, time: 0,
    }
    console.log(`HeroScene: initialized (${w}x${h}, dpr=${renderer.getPixelRatio()})`)
  }, [])

  const animate = useCallback(() => {
    const s = stateRef.current
    if (!s) return
    s.frame = requestAnimationFrame(animate)

    // Reduced motion keeps the completed emblem still instead of spinning.
    s.time = reducedMotionRef.current ? 0 : s.time + 0.016
    const t = s.time
    const p = reducedMotionRef.current ? 0.35 : progressRef.current

    // ── Act 1: merge along Y (0 → 0.35) ────────────────────
    const merge = easeInOutCubic(clamp01(p / 0.35))
    const sep = 4.0 * (1 - merge)
    // Up-tetra (green) starts below, rises to origin
    // Down-tetra (red) starts above, drops to origin
    s.upTetra.position.y = -sep
    s.downTetra.position.y = sep

    // The landscape itself is centered with object-fit: contain, but the
    // snow summit sits roughly 6px left of the exact midpoint in a 960px
    // source-frame reference. In perspective the crystal silhouettes also
    // drift perceptually as they rotate. Nudge the entire linked group
    // (both tetrahedra, their inner octahedron and all mineral grains)
    // ~0.09 world units left to register the top green vertex with that
    // actual photographic summit. The camera and video remain untouched.
    // ?heroAlign=geometric restores an exact x=0 pivot for comparison.
    const opticalAlign = new URLSearchParams(window.location.search).get('heroAlign') !== 'geometric'
    s.pivot.position.x = opticalAlign && landscapeRef.current ? -0.09 : 0

    // Slow Y rotation
    s.pivot.rotation.y = t * 0.15

    // ── Mineral color evolution ──────────────────────────────
    // Keep the two tetrahedra recognizably red/green while the
    // intersection becomes the moving carrier of the full spectrum.
    const spectrum = mineralAt(t * 0.055 + merge * 0.18)
    const intersection = mineralAt(t * 0.055 + 0.50)

    const uFace = (s.upTetra.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial
    const dFace = (s.downTetra.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial
    const uEdge = (s.upTetra.children[1] as THREE.LineSegments).material as THREE.LineBasicMaterial
    const dEdge = (s.downTetra.children[1] as THREE.LineSegments).material as THREE.LineBasicMaterial

    // Brand poles stay stable until convergence. Then the edges pick up
    // mineral light while the translucent faces remain quiet.
    const colorBlend = merge * 0.42
    uEdge.color.set(EMERALD).lerp(intersection, colorBlend)
    dEdge.color.set(RED).lerp(spectrum, colorBlend)
    uFace.color.set(EMERALD).lerp(intersection, colorBlend * 0.32)
    dFace.color.set(RED).lerp(spectrum, colorBlend * 0.32)

    const fO = 0.12 + merge * 0.22
    const eO = 0.7 + merge * 0.25

    uFace.opacity = fO
    dFace.opacity = fO
    uEdge.opacity = eO
    dEdge.opacity = eO

    // Breathe when merged — deeper, slower pulse
    const breathe = merge > 0.95 ? 1 + Math.sin(t * 1.5) * 0.02 : 1
    s.upTetra.scale.setScalar(breathe)
    s.downTetra.scale.setScalar(breathe)

    // Intersection octahedron: aurora pulse through the mineral spectrum
    const octaMat = s.octaWire.material as THREE.LineBasicMaterial
    const auroraColor = mineralAt(t * 0.045 + merge * 0.35)
    octaMat.color.copy(auroraColor)
    octaMat.opacity = merge * (0.44 + Math.sin(t * 1.7) * 0.12)

    // ── Act 2: orbit particles + sun/moon (0.30 → 0.55) ────
    const orbitFade = clamp01((p - 0.30) / 0.25)
    const oMat = s.orbit.points.material as THREE.PointsMaterial
    oMat.opacity = orbitFade * 0.5

    // Sun: static top-right, screen-parallel
    // The landscape footage already includes the sun and moon.
    s.sun.visible = !landscapeRef.current && orbitFade > 0.01
    s.sun.position.set(3.2, 2.2, -1)
    s.sun.quaternion.copy(s.camera.quaternion)

    // Moon: static top-left, same height as sun
    s.moon.visible = !landscapeRef.current && orbitFade > 0.01
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

    // ── Act 3: hold the merged geometry at a constant screen size ──
    // Previous scroll-controlled camera pull-back made both tetrahedrons
    // appear to shrink during the later chapters. Keep the original camera
    // framing throughout; the ascent, convergence, rotation and final
    // opacity fade remain scroll-driven and reversible.
    // (Initial camera stays at (0, 1.5, 9), looking toward the origin.)

    // ── Act 4: erode solid faces into mineral grains (0.82 → 1.0).
    // Rewind is deterministic: there is no particle state to re-simulate.
    // Use a single scroll uniform for mesh erosion and grain movement.
    // Do NOT add a second cubic easing here; the chapter scroll is already
    // smoothstepped and double easing had compressed the visible movement.
    const dissolve = clamp01((p - 0.82) / 0.18)
    s.erosion.value = dissolve
    s.mineralGrains.material.uniforms.uProgress.value = dissolve
    s.mineralGrains.visible = dissolve > 0.002
    const fade = dissolve
    const inv = 1 - dissolve

    // Face fragments vanish through the shader erosion mask, not by
    // fading the whole face uniformly. Edge glow gently dims behind the dust.
    uFace.opacity = fO
    dFace.opacity = fO
    uEdge.opacity = eO
    dEdge.opacity = eO
    oMat.opacity = orbitFade * 0.5 * inv
    // The third shape now erodes via the SAME spatial discard mask as the
    // outer tetrahedrons. Do not fade it out ahead of its sampled grains.
    octaMat.opacity = merge * 0.5

    // Hide sun/moon during fadeout
    if (fade > 0.5) {
      s.sun.visible = false
      s.moon.visible = false
    }

    // Make the dissolving crystals transparent over the SAME pigment field,
    // even if the optional landscape video never finished loading.
    s.scene.background = landscapeRef.current || dissolve > 0.002
      ? null
      : new THREE.Color(BG).lerp(new THREE.Color(GL.darkBg), fade)

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
      s.mineralGrains.material.uniforms.uDpr.value = s.renderer.getPixelRatio()
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
        s.mineralGrains.geometry.dispose()
        s.mineralGrains.material.dispose()
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
      className="pointer-events-none absolute inset-0 z-[2]"
      style={{ width: '100%', height: '100%' }}
    />
  )
}
