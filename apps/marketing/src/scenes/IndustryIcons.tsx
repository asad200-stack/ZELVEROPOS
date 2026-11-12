import { Environment, Lightformer, PerspectiveCamera, RoundedBox, View } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';

export interface IconPointer {
  x: number;
  y: number;
  hover: boolean;
}

type Vec3 = [number, number, number];

const ACCENT: Record<string, string> = {
  'mobile-electronics': '#4f7dff',
  supermarkets: '#34d399',
  'fashion-retail': '#f472b6',
  wholesale: '#fbbf24',
  beauty: '#a78bfa',
  'general-retail': '#4fd1c5',
};

/* ---------- textures ---------- */

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function glowTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });
}

/* ---------- helpers ---------- */

const UP = new THREE.Vector3(0, 1, 0);

function Bar({ from, to, r = 0.016, children }: { from: Vec3; to: Vec3; r?: number; children: ReactNode }) {
  const a = new THREE.Vector3(...from);
  const d = new THREE.Vector3(...to).sub(a);
  const pos = a.addScaledVector(d, 0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
  return (
    <mesh position={pos} quaternion={quat}>
      <cylinderGeometry args={[r, r, d.length(), 10]} />
      {children}
    </mesh>
  );
}

const Chrome = () => <meshStandardMaterial color="#e3e9f2" metalness={1} roughness={0.22} />;
const Gold = () => <meshStandardMaterial color="#f3c27a" metalness={1} roughness={0.18} />;

/* ---------- models ---------- */

function Phone() {
  const screen = useMemo(
    () =>
      canvasTexture(256, 512, (g) => {
        rr(g, 0, 0, 256, 512, 30);
        g.clip();
        const bg = g.createLinearGradient(0, 0, 256, 512);
        bg.addColorStop(0, '#2347c8');
        bg.addColorStop(0.55, '#5b2fc4');
        bg.addColorStop(1, '#0a0f2a');
        g.fillStyle = bg;
        g.fillRect(0, 0, 256, 512);
        const glow = g.createRadialGradient(190, 110, 6, 190, 110, 230);
        glow.addColorStop(0, 'rgba(130,210,255,0.6)');
        glow.addColorStop(1, 'rgba(130,210,255,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, 256, 512);
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.font = '600 56px system-ui, sans-serif';
        g.fillText('9:41', 128, 124);
        g.globalAlpha = 0.8;
        g.font = '600 15px system-ui, sans-serif';
        g.fillText('ZELVERO POS', 128, 152);
        g.globalAlpha = 1;
        const colors = ['#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#22d3ee', '#f87171', '#e2e8f0'];
        for (let i = 0; i < 8; i++) {
          g.fillStyle = colors[i];
          rr(g, 34 + (i % 4) * 52, 206 + Math.floor(i / 4) * 62, 40, 40, 11);
          g.fill();
        }
        g.fillStyle = 'rgba(255,255,255,0.16)';
        rr(g, 16, 428, 224, 64, 24);
        g.fill();
        for (let i = 0; i < 4; i++) {
          g.fillStyle = colors[(i * 3) % 8];
          rr(g, 34 + i * 52, 440, 40, 40, 11);
          g.fill();
        }
        g.fillStyle = '#000';
        rr(g, 90, 16, 76, 22, 11);
        g.fill();
      }),
    [],
  );
  return (
    <group rotation={[0.08, -0.3, -0.12]} scale={0.8} position={[0, 0.04, 0]}>
      <RoundedBox args={[0.8, 1.6, 0.09]} radius={0.044} smoothness={4}>
        <meshPhysicalMaterial color="#2c3446" metalness={1} roughness={0.2} clearcoat={1} clearcoatRoughness={0.08} />
      </RoundedBox>
      <mesh position={[0, 0, 0.0456]}>
        <planeGeometry args={[0.74, 1.52]} />
        <meshBasicMaterial map={screen} transparent toneMapped={false} />
      </mesh>
      <mesh position={[0.405, 0.35, 0]}>
        <boxGeometry args={[0.02, 0.22, 0.04]} />
        <Chrome />
      </mesh>
      <RoundedBox args={[0.34, 0.34, 0.03]} radius={0.012} position={[-0.17, 0.55, -0.056]}>
        <meshPhysicalMaterial color="#1a2030" metalness={0.9} roughness={0.3} clearcoat={1} />
      </RoundedBox>
      {(
        [
          [-0.25, 0.63],
          [-0.25, 0.47],
          [-0.09, 0.55],
        ] as const
      ).map(([x, y]) => (
        <group key={`${x}${y}`} position={[x, y, -0.078]} rotation-x={Math.PI / 2}>
          <mesh>
            <cylinderGeometry args={[0.058, 0.058, 0.02, 28]} />
            <Chrome />
          </mesh>
          <mesh position={[0, -0.011, 0]}>
            <cylinderGeometry args={[0.042, 0.042, 0.004, 28]} />
            <meshPhysicalMaterial color="#04060c" metalness={1} roughness={0.04} clearcoat={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Cart({ accent }: { accent: string }) {
  const wires = useMemo(() => {
    const at = (t: number) => ({ y: -0.155 + 0.55 * t, x: 0.43 + 0.16 * t, z: 0.318 + 0.12 * t });
    const lo = at(0);
    const hi = at(1);
    const out: { from: Vec3; to: Vec3; r: number }[] = [];
    for (let u = -1; u <= 1.001; u += 0.25)
      for (const s of [1, -1]) out.push({ from: [u * lo.x, lo.y, s * lo.z], to: [u * hi.x, hi.y, s * hi.z], r: 0.011 });
    for (const v of [-0.66, -0.33, 0, 0.33, 0.66])
      for (const s of [1, -1]) out.push({ from: [s * lo.x, lo.y, v * lo.z], to: [s * hi.x, hi.y, v * hi.z], r: 0.011 });
    for (const t of [0, 0.34, 0.67, 1]) {
      const { x, y, z } = at(t);
      const r = t === 1 ? 0.022 : 0.011;
      out.push({ from: [-x, y, z], to: [x, y, z], r }, { from: [-x, y, -z], to: [x, y, -z], r });
      out.push({ from: [x, y, -z], to: [x, y, z], r }, { from: [-x, y, -z], to: [-x, y, z], r });
    }
    for (const v of [-0.5, 0, 0.5]) out.push({ from: [-lo.x, lo.y, v * lo.z], to: [lo.x, lo.y, v * lo.z], r: 0.011 });
    return out;
  }, []);
  const wheels: Vec3[] = [
    [-0.4, -0.57, 0.3],
    [-0.4, -0.57, -0.3],
    [0.48, -0.57, 0.3],
    [0.48, -0.57, -0.3],
  ];
  return (
    <group rotation={[0, -0.65, 0]} position={[0.05, 0.04, 0]} scale={0.95}>
      {wires.map((w, i) => (
        <Bar key={i} from={w.from} to={w.to} r={w.r}>
          <Chrome />
        </Bar>
      ))}
      {[0.42, -0.42].map((z) => (
        <Bar key={z} from={[-0.58, 0.39, z]} to={[-0.8, 0.62, z]} r={0.02}>
          <Chrome />
        </Bar>
      ))}
      <Bar from={[-0.8, 0.62, -0.48]} to={[-0.8, 0.62, 0.48]} r={0.042}>
        <meshPhysicalMaterial color={accent} roughness={0.35} clearcoat={1} emissive={accent} emissiveIntensity={0.25} />
      </Bar>
      {[0.3, -0.3].map((z) => (
        <group key={z}>
          <Bar from={[-0.43, -0.153, z]} to={[-0.4, -0.5, z]}>
            <Chrome />
          </Bar>
          <Bar from={[0.43, -0.153, z]} to={[0.48, -0.5, z]}>
            <Chrome />
          </Bar>
          <Bar from={[-0.4, -0.5, z]} to={[0.48, -0.5, z]}>
            <Chrome />
          </Bar>
        </group>
      ))}
      {wheels.map((p) => (
        <group key={p.join()} position={p} rotation-x={Math.PI / 2}>
          <mesh>
            <cylinderGeometry args={[0.068, 0.068, 0.05, 24]} />
            <meshStandardMaterial color="#0d1018" roughness={0.6} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.03, 0.03, 0.056, 12]} />
            <Chrome />
          </mesh>
        </group>
      ))}
      <mesh position={[0.16, 0.2, 0.02]} rotation-y={0.2}>
        <boxGeometry args={[0.3, 0.42, 0.2]} />
        <meshPhysicalMaterial color={accent} roughness={0.35} clearcoat={0.8} emissive={accent} emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[-0.2, 0.06, -0.06]} rotation-y={-0.3}>
        <boxGeometry args={[0.26, 0.28, 0.26]} />
        <meshPhysicalMaterial color="#fb923c" roughness={0.4} clearcoat={0.6} />
      </mesh>
      <mesh position={[-0.05, 0.12, 0.2]}>
        <cylinderGeometry args={[0.08, 0.08, 0.3, 24]} />
        <meshStandardMaterial color="#f43f5e" metalness={0.7} roughness={0.25} />
      </mesh>
    </group>
  );
}

function Hanger({ accent }: { accent: string }) {
  const body = useMemo(() => {
    const pts = [
      [0, 0.36],
      [0.36, 0.17],
      [0.72, -0.04],
      [0.83, -0.13],
      [0.72, -0.19],
      [0, -0.19],
      [-0.72, -0.19],
      [-0.83, -0.13],
      [-0.72, -0.04],
      [-0.36, 0.17],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), 180, 0.032, 10, true);
  }, []);
  const cloth = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1.05, 0.78, 36, 16);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const drop = (0.39 - y) / 0.78;
      p.setZ(i, Math.sin(x * 15) * 0.045 * (0.25 + drop) + drop * drop * 0.08);
      p.setX(i, x * (1 - drop * 0.08));
    }
    geo.computeVertexNormals();
    return geo;
  }, []);
  return (
    <group position={[0, 0.1, 0]} scale={0.86} rotation={[0, -0.25, 0.04]}>
      <mesh geometry={body}>
        <Gold />
      </mesh>
      <Bar from={[0, 0.34, 0]} to={[0, 0.46, 0]} r={0.026}>
        <Gold />
      </Bar>
      <mesh position={[0, 0.59, 0]} rotation-z={-Math.PI / 2}>
        <torusGeometry args={[0.13, 0.026, 10, 32, Math.PI * 1.4]} />
        <Gold />
      </mesh>
      <mesh geometry={cloth} position={[0, -0.58, 0.02]}>
        <meshPhysicalMaterial color={accent} roughness={0.55} sheen={1} sheenColor="#ffd6ea" sheenRoughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      <group position={[0.36, -0.62, 0.1]} rotation-z={0.25}>
        <RoundedBox args={[0.18, 0.26, 0.016]} radius={0.006}>
          <meshPhysicalMaterial color="#f8fafc" roughness={0.4} clearcoat={0.6} />
        </RoundedBox>
        <mesh position={[0, 0.06, 0.01]}>
          <planeGeometry args={[0.12, 0.03]} />
          <meshBasicMaterial color={accent} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function Pallet({ accent }: { accent: string }) {
  const board = useMemo(
    () =>
      canvasTexture(256, 256, (g) => {
        g.fillStyle = '#b97c3e';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 90; i++) {
          g.fillStyle = `rgba(${i % 2 ? '80,45,15' : '235,180,110'},0.08)`;
          g.fillRect(0, Math.random() * 256, 256, 1 + Math.random() * 2);
        }
        g.fillStyle = '#e9b46a';
        g.fillRect(112, 0, 32, 256);
        g.strokeStyle = 'rgba(40,20,5,0.75)';
        g.lineWidth = 6;
        g.strokeRect(30, 150, 66, 66);
        g.fillStyle = 'rgba(40,20,5,0.75)';
        g.font = '700 26px system-ui, sans-serif';
        g.fillText('↑↑', 44, 194);
        g.font = '800 22px system-ui, sans-serif';
        g.fillText('ZELVERO', 150, 60);
      }),
    [],
  );
  const boxes: { p: Vec3; r: number }[] = [
    { p: [-0.25, -0.17, -0.25], r: 0 },
    { p: [0.25, -0.17, -0.25], r: 0 },
    { p: [-0.25, -0.17, 0.25], r: 0 },
    { p: [0.25, -0.17, 0.25], r: 0 },
    { p: [0.02, 0.32, 0.02], r: 0.3 },
  ];
  return (
    <group rotation={[0, 0.65, 0]} scale={0.92} position={[0, 0.04, 0]}>
      {boxes.map(({ p, r }) => (
        <mesh key={p.join()} position={p} rotation-y={r}>
          <boxGeometry args={[0.48, 0.48, 0.48]} />
          <meshStandardMaterial map={board} roughness={0.75} />
        </mesh>
      ))}
      {[-0.44, -0.22, 0, 0.22, 0.44].map((z) => (
        <mesh key={z} position={[0, -0.435, z]}>
          <boxGeometry args={[1.1, 0.04, 0.15]} />
          <meshStandardMaterial color="#7a5230" roughness={0.85} />
        </mesh>
      ))}
      {[-0.44, 0, 0.44].map((x) => (
        <mesh key={x} position={[x, -0.51, 0]}>
          <boxGeometry args={[0.13, 0.11, 1.1]} />
          <meshStandardMaterial color="#5d3d22" roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0.25, -0.2, 0.492]}>
        <planeGeometry args={[0.24, 0.12]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Perfume({ accent }: { accent: string }) {
  return (
    <group rotation={[0, -0.4, 0]} position={[0.02, 0.08, 0]} scale={1.12}>
      <group position={[-0.17, 0, 0]}>
        <RoundedBox args={[0.5, 0.48, 0.24]} radius={0.07} position={[0, -0.26, 0]}>
          <meshPhysicalMaterial color={accent} roughness={0.15} clearcoat={1} emissive={accent} emissiveIntensity={0.35} />
        </RoundedBox>
        <RoundedBox args={[0.64, 0.8, 0.36]} radius={0.11} position={[0, -0.12, 0]}>
          <meshPhysicalMaterial color="#f1ecff" roughness={0.04} metalness={0} clearcoat={1} transparent opacity={0.42} depthWrite={false} envMapIntensity={3} />
        </RoundedBox>
        <mesh position={[0, 0.33, 0]}>
          <cylinderGeometry args={[0.07, 0.08, 0.12, 24]} />
          <Gold />
        </mesh>
        <mesh position={[0, 0.51, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.26, 6]} />
          <meshPhysicalMaterial color="#f6c983" metalness={0.85} roughness={0.32} clearcoat={1} clearcoatRoughness={0.1} />
        </mesh>
      </group>
      <group position={[0.4, -0.2, 0.12]} rotation-z={-0.08}>
        <mesh position={[0, -0.14, 0]}>
          <cylinderGeometry args={[0.095, 0.095, 0.32, 32]} />
          <meshPhysicalMaterial color="#0b0d14" metalness={0.6} roughness={0.15} clearcoat={1} />
        </mesh>
        <mesh position={[0, 0.045, 0]}>
          <cylinderGeometry args={[0.098, 0.098, 0.05, 32]} />
          <Gold />
        </mesh>
        <mesh position={[0, 0.16, 0]}>
          <cylinderGeometry args={[0.045, 0.072, 0.18, 32]} />
          <meshPhysicalMaterial color="#e11d48" roughness={0.3} clearcoat={0.8} />
        </mesh>
      </group>
    </group>
  );
}

function Storefront({ accent }: { accent: string }) {
  const awning = useMemo(
    () =>
      canvasTexture(256, 64, (g) => {
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? '#f8fafc' : accent;
          g.fillRect(i * 32, 0, 32, 64);
        }
      }),
    [accent],
  );
  const sign = useMemo(
    () =>
      canvasTexture(512, 96, (g) => {
        g.fillStyle = '#0a1020';
        g.fillRect(0, 0, 512, 96);
        g.fillStyle = accent;
        g.shadowColor = accent;
        g.shadowBlur = 18;
        g.font = '800 54px system-ui, sans-serif';
        g.textAlign = 'center';
        g.fillText('ZELVERO STORE', 256, 68);
      }),
    [accent],
  );
  const shelves = useMemo(
    () =>
      canvasTexture(256, 180, (g) => {
        const bg = g.createLinearGradient(0, 0, 0, 180);
        bg.addColorStop(0, '#ffe2ad');
        bg.addColorStop(1, '#f6a95b');
        g.fillStyle = bg;
        g.fillRect(0, 0, 256, 180);
        g.fillStyle = 'rgba(60,30,10,0.55)';
        for (const y of [60, 120]) g.fillRect(0, y, 256, 6);
        const items = ['#4f7dff', '#f472b6', '#34d399', '#fbbf24', '#a78bfa'];
        for (let row = 0; row < 3; row++)
          for (let i = 0; i < 7; i++) {
            g.fillStyle = items[(i + row * 2) % items.length];
            const h = 22 + ((i * 7 + row * 3) % 4) * 6;
            g.fillRect(14 + i * 34, row * 60 + 56 - h, 22, h);
          }
      }),
    [],
  );
  return (
    <group rotation={[0, -0.5, 0]} position={[0, 0.02, 0]} scale={0.95}>
      <mesh position={[0, -0.12, 0]}>
        <boxGeometry args={[1.3, 0.86, 0.7]} />
        <meshStandardMaterial color="#222b3e" roughness={0.55} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <boxGeometry args={[1.42, 0.08, 0.82]} />
        <meshStandardMaterial color="#323d57" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.2, 0.352]}>
        <planeGeometry args={[1.06, 0.2]} />
        <meshBasicMaterial map={sign} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.03, 0.5]} rotation-x={0.5}>
        <boxGeometry args={[1.38, 0.025, 0.34]} />
        <meshStandardMaterial map={awning} roughness={0.6} />
      </mesh>
      <mesh position={[-0.24, -0.27, 0.352]}>
        <planeGeometry args={[0.62, 0.42]} />
        <meshBasicMaterial map={shelves} toneMapped={false} />
      </mesh>
      <mesh position={[0.4, -0.3, 0.355]}>
        <boxGeometry args={[0.28, 0.5, 0.02]} />
        <meshPhysicalMaterial color={accent} roughness={0.1} clearcoat={1} emissive={accent} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, -0.565, 0.1]}>
        <boxGeometry args={[1.5, 0.03, 1]} />
        <meshStandardMaterial color="#1a2030" roughness={0.5} metalness={0.4} />
      </mesh>
    </group>
  );
}

function Model({ slug, accent }: { slug: string; accent: string }) {
  switch (slug) {
    case 'mobile-electronics':
      return <Phone />;
    case 'supermarkets':
      return <Cart accent={accent} />;
    case 'fashion-retail':
      return <Hanger accent={accent} />;
    case 'wholesale':
      return <Pallet accent={accent} />;
    case 'beauty':
      return <Perfume accent={accent} />;
    default:
      return <Storefront accent={accent} />;
  }
}

/* ---------- stage ---------- */

export function IconStage({
  slot,
  pointer,
  index,
  accent,
  children,
}: {
  slot: { current: unknown };
  pointer: { current: IconPointer };
  index: number;
  accent: string;
  children: ReactNode;
}) {
  const g = useRef<THREE.Group>(null);
  const st = useRef({ start: -1, flip: 0, flipTo: 0, was: false, rx: 0, ry: 0, s: 1 });
  const glow = useMemo(() => glowTexture(), []);

  useFrame((state, dt) => {
    const grp = g.current;
    if (!grp) return;
    const t = state.clock.elapsedTime;
    const s = st.current;
    const p = pointer.current;
    const el = slot.current instanceof HTMLElement ? slot.current : null;
    const shown = !el || (el.closest('.zw-section')?.classList.contains('is-in') ?? true);
    if (shown && s.start < 0) s.start = t + index * 0.1;
    const a = s.start < 0 ? 0 : Math.min(1, Math.max(0, (t - s.start) / 0.9));
    const pop = a === 0 ? 0 : 1 + 2.70158 * Math.pow(a - 1, 3) + 1.70158 * Math.pow(a - 1, 2);
    if (p.hover && !s.was) s.flipTo += Math.PI * 2;
    s.was = p.hover;
    const k = 1 - Math.exp(-dt * 6);
    s.flip += (s.flipTo - s.flip) * (1 - Math.exp(-dt * 3.4));
    s.rx += ((p.hover ? p.y * 0.6 : 0) - s.rx) * k;
    s.ry += ((p.hover ? p.x * 0.9 : 0) - s.ry) * k;
    s.s += ((p.hover ? 1.1 : 1) - s.s) * k;
    grp.scale.setScalar(Math.max(1e-4, pop * s.s));
    grp.rotation.set(0.14 + s.rx, Math.sin(t * 0.7 + index * 1.3) * 0.38 + s.ry + s.flip - (1 - a) ** 2 * 2.6, 0);
    grp.position.y = Math.sin(t * 1.3 + index) * 0.05;
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0.3, 3.5]} fov={30} onUpdate={(c) => c.lookAt(0, -0.02, 0)} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[2.5, 3, 3]} intensity={2.4} />
      <pointLight position={[-1.8, -0.6, 1.6]} intensity={5} color={accent} />
      <pointLight position={[1.6, 1.2, -1.5]} intensity={4} color="#9cc2ff" />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={5} position={[0, 4, 1]} scale={[6, 1.2, 1]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={3} color="#9cc2ff" position={[-4, 1, 1]} scale={[1, 5, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={3} color={accent} position={[4, 0.5, 1]} scale={[1, 5, 1]} rotation-y={-Math.PI / 2} />
        <Lightformer form="rect" intensity={2} position={[0, 1, 5]} scale={[3, 0.5, 1]} />
      </Environment>
      <group ref={g}>{children}</group>
      <mesh position={[0, -0.72, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[2.4, 1.6]} />
        <meshBasicMaterial map={glow} color={accent} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </>
  );
}

export function IndustryMark3D({ slug, index, pointer }: { slug: string; index: number; pointer: { current: IconPointer } }) {
  const slot = useRef<HTMLElement | THREE.Group>(null);
  const accent = ACCENT[slug] ?? '#4f7dff';
  return (
    <View ref={slot} className="zw-industry__3d">
      <IconStage slot={slot} pointer={pointer} index={index} accent={accent}>
        <Model slug={slug} accent={accent} />
      </IconStage>
    </View>
  );
}

export function IndustryIconsCanvas({ active }: { active: boolean }) {
  return (
    <Canvas
      className="zw-icons3d"
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 1.75]}
      gl={{ alpha: true, antialias: true, stencil: false, powerPreference: 'high-performance' }}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 30, visibility: active ? 'visible' : 'hidden' }}
    >
      <View.Port />
    </Canvas>
  );
}
