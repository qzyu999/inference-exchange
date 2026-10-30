import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * MineralFlowField
 *
 * A dark, art-directed pigment field rather than generic blurred rainbow noise.
 * The fullscreen GLSL pass draws layered, slightly granular mineral ribbons
 * moving quietly to the right. It intentionally leaves the left portion darker
 * so headings, prices, and controls retain contrast.
 *
 * Used underneath the sand's final scroll beat AND the product overview, so the
 * two screens feel connected. No sacred mandala patterns are reproduced.
 */

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const fragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float weight = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += weight * noise(p);
      p *= 2.03;
      weight *= 0.5;
    }
    return sum;
  }

  vec3 palette(float t) {
    // Mineral spectrum: cinnabar -> gold -> jade -> turquoise -> sapphire ->
    // indigo. Colors are deliberately muted for UI legibility.
    vec3 cinnabar = vec3(0.70, 0.20, 0.17);
    vec3 gold = vec3(0.78, 0.51, 0.23);
    vec3 jade = vec3(0.08, 0.45, 0.33);
    vec3 turquoise = vec3(0.23, 0.56, 0.55);
    vec3 sapphire = vec3(0.17, 0.34, 0.49);
    vec3 indigo = vec3(0.34, 0.24, 0.42);
    t = clamp(t, 0.0, 0.999);
    if (t < 0.2) return mix(cinnabar, gold, t / 0.2);
    if (t < 0.4) return mix(gold, jade, (t - 0.2) / 0.2);
    if (t < 0.6) return mix(jade, turquoise, (t - 0.4) / 0.2);
    if (t < 0.8) return mix(turquoise, sapphire, (t - 0.6) / 0.2);
    return mix(sapphire, indigo, (t - 0.8) / 0.2);
  }

  void main() {
    vec2 uv = vUv;
    float time = uTime * 0.055;
    vec2 q = vec2(uv.x * 2.4 + time, uv.y * 3.6);
    float current = fbm(q + fbm(q * 0.9) * 1.6);

    float y = uv.y
      + 0.085 * sin(uv.x * 6.1 + current * 4.3 + time * 0.35)
      + (current - 0.5) * 0.12;

    float bands = abs(sin(y * 14.0 + uv.x * 2.0 + current * 2.0));
    float ridge = pow(1.0 - smoothstep(0.0, 0.94, bands), 2.5);
    float fine = pow(1.0 - abs(sin(y * 47.0 + current * 4.0)), 9.0);
    float flowing = ridge * 0.74 + fine * 0.26;
    float visibility = smoothstep(0.15, 0.45, uv.x)
      * (1.0 - smoothstep(0.92, 1.0, uv.x));

    float mineralPos = clamp(y * 0.89 + uv.x * 0.13 + current * 0.11, 0.0, 1.0);
    vec3 pigment = palette(mineralPos);
    vec3 background = vec3(0.027, 0.040, 0.057);

    // Trace layers of pigment as streaks, with granular edges rather than a
    // uniformly smooth gradient. Do not interfere with the text at left.
    float grain = hash21(floor(uv * uResolution * 0.74));
    float breakup = smoothstep(0.18, 0.78, grain);
    float ink = flowing * visibility * (0.78 + 0.22 * breakup);
    vec3 color = background + pigment * ink * 0.46;
    float subtleGlow = (current * current) * visibility * 0.018;
    color += pigment * subtleGlow;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

interface MineralFlowFieldProps {
  className?: string
  opacity?: number
}

export function MineralFlowField({ className = '', opacity = 1 }: MineralFlowFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scene = new THREE.Scene()
    const camera = new THREE.Camera()
    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
    })
    scene.add(new THREE.Mesh(geometry, material))

    let renderer: THREE.WebGLRenderer | null = null
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: 'low-power',
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35))
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'
      el.appendChild(renderer.domElement)
    } catch {
      // The CSS gradient below is a deliberate static fallback when the GPU
      // renderer is unavailable (e.g. old browsers, restricted hardware).
      geometry.dispose()
      material.dispose()
      return
    }

    const gpu = renderer
    let frame = 0
    let visible = true
    let started = performance.now()

    const resize = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      gpu.setSize(width, height, false)
      material.uniforms.uResolution.value.set(width * gpu.getPixelRatio(), height * gpu.getPixelRatio())
      gpu.render(scene, camera)
    }

    const animate = () => {
      if (!visible) return
      material.uniforms.uTime.value = (performance.now() - started) / 1000
      gpu.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }

    const observer = new IntersectionObserver(entries => {
      const next = entries[0]?.isIntersecting ?? false
      if (next === visible) return
      visible = next
      cancelAnimationFrame(frame)
      if (next && !prefersReducedMotion) {
        started = performance.now() - material.uniforms.uTime.value * 1000
        frame = requestAnimationFrame(animate)
      }
    }, { threshold: 0.01 })
    observer.observe(el)
    window.addEventListener('resize', resize)
    resize()
    if (!prefersReducedMotion) frame = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', resize)
      geometry.dispose()
      material.dispose()
      gpu.dispose()
      if (gpu.domElement.parentNode === el) el.removeChild(gpu.domElement)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={className}
      style={{
        pointerEvents: 'none',
        opacity,
        background: 'radial-gradient(ellipse at 80% 30%, rgba(8,127,91,0.18), transparent 45%), radial-gradient(ellipse at 90% 82%, rgba(200,58,50,0.12), transparent 48%), #111A26',
      }}
    />
  )
}
