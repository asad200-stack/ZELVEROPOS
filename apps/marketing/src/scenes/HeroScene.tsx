import { Environment, Lightformer, MeshReflectorMaterial, RoundedBox } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useInView } from '../hooks/useInView';
import { useIsMobile, usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { boltPath, onRect, writeRibbon } from './lightning';
import { hasWebGL, hero3dPaused, shouldLoadHero3d } from './policy';

/**
 * Hero centrepiece: a machined dark-metal ZELVERO cube in a studio, lit by an
 * environment of light strips, with an engraved emissive logo, crawling
 * electricity, sparks and a reflective floor. Reacts to pointer, scroll and clicks.
 */

/* ---------- procedural textures ---------- */

function noiseLines(g: CanvasRenderingContext2D, size: number, alpha: number) {
  for (let i = 0; i < 2600; i++) {
    const y = Math.random() * size;
    const x = Math.random() * size;
    const len = 20 + Math.random() * 160;
    g.strokeStyle = `rgba(255,255,255,${Math.random() * alpha})`;
    g.lineWidth = Math.random() < 0.9 ? 1 : 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y + (Math.random() - 0.5) * 2);
    g.stroke();
  }
}

function panelSeams(g: CanvasRenderingContext2D, s: number, color: string, w: number) {
  g.strokeStyle = color;
  g.lineWidth = w;
  const m = s * 0.07;
  g.strokeRect(m, m, s - m * 2, s - m * 2);
  const c = s * 0.16;
  g.beginPath();
  // chamfered inner frame
  g.moveTo(m * 2 + c, m * 2);
  g.lineTo(s - m * 2 - c, m * 2);
  g.lineTo(s - m * 2, m * 2 + c);
  g.lineTo(s - m * 2, s - m * 2 - c);
  g.lineTo(s - m * 2 - c, s - m * 2);
  g.lineTo(m * 2 + c, s - m * 2);
  g.lineTo(m * 2, s - m * 2 - c);
  g.lineTo(m * 2, m * 2 + c);
  g.closePath();
  g.stroke();
}

function circuits(g: CanvasRenderingContext2D, s: number, seed: number, color: string, width: number) {
  let a = seed;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  for (let i = 0; i < 14; i++) {
    let x = s * (0.18 + r() * 0.64);
    let y = s * (0.18 + r() * 0.64);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      const horiz = r() > 0.5;
      const d = (r() - 0.5) * s * 0.4;
      if (horiz) x = Math.min(s * 0.86, Math.max(s * 0.14, x + d));
      else y = Math.min(s * 0.86, Math.max(s * 0.14, y + d));
      g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath();
    g.arc(x, y, width * 2.2, 0, Math.PI * 2);
    g.fill();
  }
}

type FaceTex = { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture; rough: THREE.CanvasTexture };

function faceTextures(logo: boolean, seed: number, size: number): FaceTex {
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return [c, c.getContext('2d')!] as const;
  };
  const font = `800 ${size * 0.15}px 'Segoe UI', system-ui, sans-serif`;
  const drawLogo = (g: CanvasRenderingContext2D, fill: string, blur = 0, glow = '') => {
    g.save();
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${size * 0.012}px`;
    if (blur) {
      g.shadowBlur = blur;
      g.shadowColor = glow;
    }
    g.fillStyle = fill;
    g.fillText('ZELVERO', size / 2, size / 2);
    g.restore();
  };

  // albedo
  const [mc, m] = mk();
  m.fillStyle = '#3a4150';
  m.fillRect(0, 0, size, size);
  noiseLines(m, size, 0.05);
  panelSeams(m, size, 'rgba(0,0,0,0.85)', size * 0.008);
  panelSeams(m, size + 3, 'rgba(255,255,255,0.08)', size * 0.002);
  if (logo) {
    m.save();
    m.translate(0, size * 0.004);
    drawLogo(m, 'rgba(255,255,255,0.25)');
    m.restore();
    drawLogo(m, '#05070b');
  } else {
    circuits(m, size, seed, 'rgba(0,0,0,0.6)', size * 0.006);
  }

  // emissive
  const [ec, e] = mk();
  e.fillStyle = '#000';
  e.fillRect(0, 0, size, size);
  panelSeams(e, size, 'rgba(70,140,255,0.22)', size * 0.003);
  circuits(e, size, seed, 'rgba(90,170,255,0.7)', size * 0.0028);
  if (logo) drawLogo(e, '#d8ecff', size * 0.02, 'rgba(90,170,255,1)');

  // roughness (white = rough)
  const [rc, rg] = mk();
  rg.fillStyle = '#8a8a8a';
  rg.fillRect(0, 0, size, size);
  noiseLines(rg, size, 0.18);
  panelSeams(rg, size, '#fff', size * 0.01);

  const map = new THREE.CanvasTexture(mc);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(ec);
  emissive.colorSpace = THREE.SRGBColorSpace;
  const rough = new THREE.CanvasTexture(rc);
  for (const t of [map, emissive, rough]) t.anisotropy = 8;
  return { map, emissive, rough };
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(120,170,255,0.9)');
  grad.addColorStop(0.35, 'rgba(79,125,255,0.35)');
  grad.addColorStop(1, 'rgba(79,125,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function fadeTexture(kind: 'radial' | 'vertical'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad =
    kind === 'radial' ? g.createRadialGradient(128, 128, 0, 128, 128, 128) : g.createLinearGradient(0, 0, 0, 256);
  if (kind === 'radial') {
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.55, '#888');
    grad.addColorStop(1, '#000');
  } else {
    grad.addColorStop(0, '#000');
    grad.addColorStop(0.35, '#fff');
    grad.addColorStop(0.75, '#fff');
    grad.addColorStop(1, '#000');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/* ---------- cube ---------- */

const FACES: { pos: [number, number, number]; rot: [number, number, number]; logo: boolean }[] = [
  { pos: [0, 0, 1], rot: [0, 0, 0], logo: true },
  { pos: [0, 0, -1], rot: [0, Math.PI, 0], logo: true },
  { pos: [1, 0, 0], rot: [0, Math.PI / 2, 0], logo: false },
  { pos: [-1, 0, 0], rot: [0, -Math.PI / 2, 0], logo: false },
  { pos: [0, 1, 0], rot: [-Math.PI / 2, 0, 0], logo: false },
  { pos: [0, -1, 0], rot: [Math.PI / 2, 0, 0], logo: false },
];

const SIZE = 1.7;
const MAX_VERTS = 4000;
const SPARKS = 160;

type Energy = { level: number; burstUntil: number; nextBurst: number };

function Cube({ simple, energy }: { simple: boolean; energy: MutableRefObject<Energy> }) {
  const texSize = simple ? 512 : 1024;
  const faces = useMemo(() => FACES.map((f, i) => faceTextures(f.logo, 1234 + i * 77, texSize)), [texSize]);
  const mats = useRef<(THREE.MeshPhysicalMaterial | null)[]>([]);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : '';
    return () => {
      document.body.style.cursor = '';
    };
  }, [hover]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const e = energy.current;
    const target = hover ? 1 : performance.now() < e.burstUntil ? 0.9 : 0.25;
    e.level += (target - e.level) * 0.08;
    const pulse = 0.85 + Math.sin(t * 2.1) * 0.15;
    for (const m of mats.current) if (m) m.emissiveIntensity = (1.1 + e.level * 2.4) * pulse;
  });

  const half = SIZE / 2 + 0.002;
  return (
    <group
      onPointerOver={(ev) => {
        ev.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
      onPointerDown={(ev) => {
        ev.stopPropagation();
        energy.current.burstUntil = performance.now() + 900;
        energy.current.nextBurst = 0;
      }}
    >
      <RoundedBox args={[SIZE, SIZE, SIZE]} radius={0.09} smoothness={simple ? 3 : 6}>
        <meshPhysicalMaterial color="#1a2030" metalness={1} roughness={0.28} clearcoat={0.6} clearcoatRoughness={0.25} envMapIntensity={2.2} />
      </RoundedBox>
      {FACES.map((f, i) => (
        <mesh key={i} position={f.pos.map((v) => v * half) as [number, number, number]} rotation={f.rot}>
          <planeGeometry args={[SIZE - 0.2, SIZE - 0.2]} />
          <meshPhysicalMaterial
            ref={(m) => void (mats.current[i] = m)}
            map={faces[i].map}
            roughnessMap={faces[i].rough}
            emissiveMap={faces[i].emissive}
            emissive="#5aa8ff"
            emissiveIntensity={1.4}
            metalness={1}
            roughness={0.55}
            clearcoat={0.5}
            clearcoatRoughness={0.3}
            envMapIntensity={2}
          />
        </mesh>
      ))}
    </group>
  );
}

function Electricity({ energy, simple }: { energy: MutableRefObject<Energy>; simple: boolean }) {
  const core = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return g;
  }, []);
  const halo = useMemo(() => core.clone(), [core]);
  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    return g;
  }, []);
  const sparks = useMemo(() => Array.from({ length: SPARKS }, () => ({ p: new THREE.Vector3(0, -99, 0), v: new THREE.Vector3(), life: 0 })), []);
  const bufs = useMemo(() => ({ c: new Float32Array(MAX_VERTS * 3), h: new Float32Array(MAX_VERTS * 3) }), []);
  const next = useRef(0);
  const spark = useRef(0);

  useFrame((_, dt) => {
    const now = performance.now();
    const e = energy.current;
    if (now > e.nextBurst && e.nextBurst !== 0) {
      e.burstUntil = now + 260 + Math.random() * 420;
      e.nextBurst = now + 1600 + Math.random() * 2600;
    }
    if (e.nextBurst === 0) e.nextBurst = now + 1200;
    const active = now < e.burstUntil || e.level > 0.6;
    if (now > next.current) {
      next.current = now + 45 + Math.random() * 60;
      let oc = 0;
      let oh = 0;
      const n = active ? Math.round(2 + e.level * (simple ? 4 : 7)) : Math.random() < 0.25 ? 1 : 0;
      const hw = SIZE * 0.47;
      for (let b = 0; b < n; b++) {
        const a = onRect(0, 0, hw, hw);
        const out = Math.random() < 0.18;
        let end;
        if (out) {
          end = { x: a.x * (1.12 + Math.random() * 0.22), y: a.y * (1.12 + Math.random() * 0.22) };
        } else {
          // crawl along the face edge towards a nearby point on the same frame
          const t = onRect(0, 0, hw, hw);
          end = { x: a.x + (t.x - a.x) * 0.35, y: a.y + (t.y - a.y) * 0.35 };
        }
        const pts = boltPath(a, end, 6, 0.55);
        const w = 0.0035 + e.level * 0.003;
        oc += writeRibbon(pts, w, 0, bufs.c, oc) * 3;
        oh += writeRibbon(pts, w * 2.6, 0, bufs.h, oh) * 3;
        if (out && !simple) {
          for (let k = 0; k < 3; k++) {
            const s = sparks[spark.current++ % SPARKS];
            s.p.set(end.x, end.y, 0.2);
            s.v.set((Math.random() - 0.5) * 1.6, Math.random() * 1.4, (Math.random() - 0.2) * 1.2);
            s.life = 0.6 + Math.random() * 0.6;
          }
        }
      }
      for (const [geo, buf, cnt] of [
        [core, bufs.c, oc],
        [halo, bufs.h, oh],
      ] as const) {
        const attr = geo.getAttribute('position') as THREE.BufferAttribute;
        (attr.array as Float32Array).set(buf.subarray(0, cnt));
        attr.needsUpdate = true;
        geo.setDrawRange(0, cnt / 3);
      }
    }
    const arr = sparkGeo.getAttribute('position') as THREE.BufferAttribute;
    sparks.forEach((s, i) => {
      if (s.life > 0) {
        s.life -= dt;
        s.v.y -= 3.2 * dt;
        s.p.addScaledVector(s.v, dt);
        if (s.life <= 0) s.p.set(0, -99, 0);
      }
      arr.setXYZ(i, s.p.x, s.p.y, s.p.z);
    });
    arr.needsUpdate = true;
  });

  return (
    <group position={[0, 0, SIZE * 0.5 + 0.015]}>
      <mesh geometry={halo} frustumCulled={false}>
        <meshBasicMaterial color={[0.15, 0.4, 1.3]} transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={core} frustumCulled={false}>
        <meshBasicMaterial color={[2.4, 2.8, 3.6]} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <points geometry={sparkGeo} frustumCulled={false}>
        <pointsMaterial color={[3, 3.2, 4]} size={0.035} sizeAttenuation transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </points>
    </group>
  );
}

function Rig({ reduced, simple, active }: { reduced: boolean; simple: boolean; active: boolean }) {
  const cube = useRef<THREE.Group>(null);
  const holder = useRef<THREE.Group>(null);
  const energy = useRef<Energy>({ level: 0.25, burstUntil: 0, nextBurst: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const viewport = useThree((s) => s.viewport);
  const size = useThree((s) => s.size);
  const glow = useMemo(glowTexture, []);
  const floorFade = useMemo(() => fadeTexture('radial'), []);
  const stripFade = useMemo(() => fadeTexture('vertical'), []);
  const wide = size.width >= 1100;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useFrame((state, dt) => {
    if (!active || hero3dPaused(document.hidden, reduced)) return;
    const t = state.clock.elapsedTime;
    const scroll = Math.min(1.5, window.scrollY / Math.max(1, window.innerHeight));
    const g = cube.current;
    const h = holder.current;
    if (!g || !h) return;
    const ty = -0.55 + pointer.current.x * 0.35 + scroll * 1.6 + Math.sin(t * 0.35) * 0.08;
    const tx = 0.22 + pointer.current.y * 0.2 + scroll * 0.4;
    g.rotation.y += (ty - g.rotation.y) * Math.min(1, dt * 3);
    g.rotation.x += (tx - g.rotation.x) * Math.min(1, dt * 3);
    // Stacked layout: the canvas already scrolls with the page, so a scroll offset makes the cube outrun the copy.
    h.position.y = (wide ? 0.05 + scroll * 1.2 : viewport.height * 0.27) + Math.sin(t * 1.1) * 0.07;
  });

  // Side layout: keep the cube in the right ~40% of the hero; stacked: centred above the copy.
  const baseX = wide ? viewport.width * 0.26 : 0;
  const scale = wide
    ? Math.min(1.15, (viewport.width * 0.36) / (SIZE * 1.35))
    : Math.min(0.8, (viewport.width * 0.62) / (SIZE * 1.35), (viewport.height * 0.34) / (SIZE * 1.35));

  return (
    <>
      <group ref={holder} position={[baseX, 0.05, 0]} scale={scale}>
        <group ref={cube}>
          <Cube simple={simple} energy={energy} />
          <Electricity energy={energy} simple={simple} />
        </group>
        <sprite position={[0, 0, -1.4]} scale={[7, 7, 1]} renderOrder={-1}>
          <spriteMaterial map={glow} transparent={false} color={[0.42, 0.42, 0.42]} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
        </sprite>
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[baseX, -1.55, 0]}>
        <planeGeometry args={[14, 14]} />
        {simple ? (
          <meshStandardMaterial color="#05070d" metalness={0.8} roughness={0.35} alphaMap={floorFade} transparent depthWrite={false} />
        ) : (
          <MeshReflectorMaterial
            alphaMap={floorFade}
            transparent
            depthWrite={false}
            resolution={512}
            mirror={0.6}
            blur={[400, 120]}
            mixBlur={1}
            mixStrength={1.6}
            roughness={0.85}
            depthScale={0.8}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.2}
            color="#06080f"
            metalness={0.6}
          />
        )}
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[baseX, -1.54, 0]}>
        <planeGeometry args={[4.5, 4.5]} />
        <meshBasicMaterial map={glow} transparent opacity={0.45} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {[-7, -4.2, -1.4, 1.4, 4.2, 7].map((x, i) => (
        <mesh key={x} position={[baseX + x, 1.2, -6 - (i % 2) * 1.5]}>
          <planeGeometry args={[0.05, 9]} />
          <meshBasicMaterial color={[0.5, 0.9, 2.2]} toneMapped={false} transparent opacity={0.55} alphaMap={stripFade} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

export default function HeroScene() {
  const reduced = usePrefersReducedMotion();
  const mobile = useIsMobile();
  const wrap = useRef<HTMLDivElement>(null);
  const visible = useInView(wrap);
  const saveData = typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 8 : 8;
  const mode = shouldLoadHero3d({ reducedMotion: reduced, webgl: hasWebGL(), mobile, saveData, cores });
  if (mode === 'off') return <div ref={wrap} className="zw-hero3d-fallback" />;
  const simple = mode === 'simple';
  const active = visible;
  return (
    <div ref={wrap} className="zw-hero3d-wrap">
      <Canvas
        className="zw-hero3d"
        dpr={simple ? [1, 1.25] : [1, 1.75]}
        camera={{ position: [0, 0.25, 6.4], fov: 32 }}
        gl={{ antialias: !simple, alpha: false, powerPreference: 'high-performance', stencil: false }}
        frameloop={active ? 'always' : 'demand'}
      >
        <color attach="background" args={['#050816']} />
        <fog attach="fog" args={['#050816', 7, 18]} />
        <ambientLight intensity={0.08} />
        <spotLight position={[3, 5, 4]} angle={0.5} penumbra={1} intensity={80} color="#dce8ff" />
        <spotLight position={[-4, 2, -3]} angle={0.6} penumbra={1} intensity={70} color="#5b8cff" />
        <pointLight position={[-3, 0.5, 2]} intensity={8} color="#7c5cff" />
        <Environment resolution={simple ? 128 : 256} frames={1}>
          <Lightformer form="rect" intensity={6} color="#ffffff" position={[0, 5, -1]} scale={[10, 1.4, 1]} rotation-x={Math.PI / 2} />
          <Lightformer form="rect" intensity={4} color="#9cc2ff" position={[-5, 1, -1]} scale={[1.2, 7, 1]} rotation-y={Math.PI / 2} />
          <Lightformer form="rect" intensity={4} color="#c3b3ff" position={[5, 1, -1]} scale={[1.2, 7, 1]} rotation-y={-Math.PI / 2} />
          <Lightformer form="rect" intensity={2.5} color="#ffffff" position={[2, 2, 5]} scale={[3, 0.4, 1]} />
          <Lightformer form="ring" intensity={2} color="#4f7dff" position={[-2, -1, 5]} scale={2.5} />
        </Environment>
        <Rig reduced={reduced} simple={simple} active={active} />
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur intensity={simple ? 0.6 : 0.95} luminanceThreshold={0.82} luminanceSmoothing={0.2} radius={0.7} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
