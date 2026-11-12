import { RoundedBox, View } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { WhyId } from '../content/why';
import { IconStage, type IconPointer } from './IndustryIcons';

const ACCENT: Record<WhyId, string> = {
  fast: '#f5b942',
  connected: '#4fd1c5',
  online: '#60a5fa',
  currency: '#fbbf24',
  credit: '#c4b5fd',
  control: '#34d399',
};

function faceTexture(draw: (g: CanvasRenderingContext2D) => void, w = 512, h = 320): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const Chrome = () => <meshStandardMaterial color="#e7edf6" metalness={1} roughness={0.18} />;
const Gold = ({ glow = 0.2 }: { glow?: number }) => (
  <meshPhysicalMaterial color="#f3c27a" metalness={1} roughness={0.22} clearcoat={1} emissive="#f59e0b" emissiveIntensity={glow} />
);

function Bolt() {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.06, 0.82);
    s.lineTo(-0.38, 0.08);
    s.lineTo(-0.04, 0.08);
    s.lineTo(-0.22, -0.82);
    s.lineTo(0.46, 0);
    s.lineTo(0.08, 0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 3 });
    g.center();
    return g;
  }, []);
  return (
    <group rotation={[0.15, -0.4, 0.05]} scale={0.92}>
      <mesh geometry={geo}>
        <meshPhysicalMaterial color="#ffe7a8" metalness={1} roughness={0.16} clearcoat={1} clearcoatRoughness={0.08} emissive="#f59e0b" emissiveIntensity={0.45} />
      </mesh>
    </group>
  );
}

function Links({ accent }: { accent: string }) {
  const ring = (x: number, stand: boolean, color?: string) => (
    <mesh position={[x, 0, 0]} rotation={stand ? [0, Math.PI / 2, 0] : [0, 0, 0]}>
      <torusGeometry args={[0.34, 0.075, 24, 72]} />
      {color ? <meshPhysicalMaterial color={color} metalness={0.9} roughness={0.18} clearcoat={1} emissive={color} emissiveIntensity={0.25} /> : <Chrome />}
    </mesh>
  );
  return (
    <group rotation={[0.5, 0.2, 0.15]} scale={0.92}>
      {ring(-0.4, false)}
      {ring(0, true, accent)}
      {ring(0.4, false)}
    </group>
  );
}

function Signal({ accent }: { accent: string }) {
  const screen = useMemo(
    () =>
      faceTexture((g) => {
        g.fillStyle = '#07111f';
        g.fillRect(0, 0, 512, 320);
        g.fillStyle = accent;
        g.shadowColor = accent;
        g.shadowBlur = 18;
        g.font = '800 78px system-ui, sans-serif';
        g.fillText('ONLINE', 36, 150);
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,0.62)';
        g.font = '600 36px system-ui, sans-serif';
        g.fillText('OFFLINE READY', 36, 230);
      }, 512, 320),
    [accent],
  );
  return (
    <group position={[0, 0.04, 0]} scale={1.22}>
      <RoundedBox args={[1.15, 0.62, 0.08]} radius={0.05} position={[0, -0.22, 0]}>
        <meshPhysicalMaterial color="#1c2436" metalness={0.8} roughness={0.25} clearcoat={1} />
      </RoundedBox>
      <mesh position={[0, -0.22, 0.041]}>
        <planeGeometry args={[1.05, 0.52]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.28, 0]}>
        <sphereGeometry args={[0.055, 24, 24]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
      {[0.16, 0.28, 0.4].map((r, i) => (
        <mesh key={r} position={[0, 0.28, 0]} rotation-z={Math.PI * 0.15}>
          <torusGeometry args={[r, 0.02, 10, 40, Math.PI * 0.7]} />
          <meshBasicMaterial color={accent} toneMapped={false} transparent opacity={i === 2 ? 0.28 : 0.95} />
        </mesh>
      ))}
    </group>
  );
}

function Coin({ symbol, color, dark }: { symbol: string; color: string; dark: string }) {
  const face = useMemo(
    () =>
      faceTexture((g) => {
        g.fillStyle = color;
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = dark;
        g.lineWidth = 14;
        g.beginPath();
        g.arc(128, 128, 100, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = dark;
        g.font = '700 92px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(symbol, 128, 136);
      }, 256, 256),
    [symbol, color, dark],
  );
  return (
    <group>
      <mesh>
        <cylinderGeometry args={[0.46, 0.46, 0.07, 48]} />
        <meshStandardMaterial color={color} metalness={1} roughness={0.28} />
      </mesh>
      <mesh position={[0, 0.037, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.42, 48]} />
        <meshStandardMaterial map={face} metalness={0.55} roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.037, 0]} rotation-x={Math.PI / 2}>
        <circleGeometry args={[0.42, 48]} />
        <meshStandardMaterial map={face} metalness={0.55} roughness={0.35} />
      </mesh>
    </group>
  );
}

function Coins() {
  return (
    <group scale={0.95}>
      <group position={[0.28, -0.06, -0.12]} rotation={[0.9, 0.2, 0.4]}>
        <Coin symbol="LL" color="#d5dbe6" dark="#3a4254" />
      </group>
      <group position={[-0.16, 0.04, 0.12]} rotation={[1.05, -0.3, 0.2]}>
        <Coin symbol="$" color="#f3c27a" dark="#6a4312" />
      </group>
    </group>
  );
}

function CreditCard({ accent }: { accent: string }) {
  const face = useMemo(
    () =>
      faceTexture((g) => {
        const bg = g.createLinearGradient(0, 0, 512, 320);
        bg.addColorStop(0, '#2a2150');
        bg.addColorStop(1, '#12162a');
        g.fillStyle = bg;
        g.fillRect(0, 0, 512, 320);
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.font = '700 34px system-ui, sans-serif';
        g.fillText('ZELVERO', 36, 64);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.font = '600 30px ui-monospace, monospace';
        g.fillText('••••  ••••  4812', 36, 196);
        g.font = '600 20px system-ui, sans-serif';
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fillText('CUSTOMER', 36, 270);
        g.fillText('CREDIT', 360, 270);
      }),
    [],
  );
  return (
    <group rotation={[0.15, -0.55, 0.04]} position={[0, 0.02, 0]} scale={0.95}>
      <RoundedBox args={[1.45, 0.9, 0.045]} radius={0.06} smoothness={4}>
        <meshPhysicalMaterial color="#241b40" metalness={0.7} roughness={0.25} clearcoat={1} />
      </RoundedBox>
      <mesh position={[0, 0, 0.024]}>
        <planeGeometry args={[1.45, 0.9]} />
        <meshBasicMaterial map={face} toneMapped={false} />
      </mesh>
      <RoundedBox args={[0.22, 0.17, 0.02]} radius={0.02} position={[-0.42, 0.08, 0.03]}>
        <Gold glow={0.45} />
      </RoundedBox>
      <mesh position={[0.5, -0.28, 0.03]}>
        <circleGeometry args={[0.08, 24]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Dashboard({ accent }: { accent: string }) {
  const screen = useMemo(
    () =>
      faceTexture((g) => {
        g.fillStyle = '#071019';
        g.fillRect(0, 0, 512, 320);
        g.strokeStyle = 'rgba(255,255,255,0.08)';
        g.lineWidth = 2;
        for (let y = 40; y < 320; y += 56) {
          g.beginPath();
          g.moveTo(24, y);
          g.lineTo(488, y);
          g.stroke();
        }
        const pts = [250, 230, 210, 160, 170, 110, 70];
        g.beginPath();
        pts.forEach((y, i) => {
          const x = 40 + i * 70;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.strokeStyle = accent;
        g.lineWidth = 6;
        g.shadowColor = accent;
        g.shadowBlur = 14;
        g.stroke();
        g.lineTo(40 + 6 * 70, 300);
        g.lineTo(40, 300);
        g.fillStyle = accent;
        g.globalAlpha = 0.18;
        g.fill();
        g.globalAlpha = 1;
        g.shadowBlur = 0;
        g.fillStyle = accent;
        g.beginPath();
        g.arc(40 + 6 * 70, 70, 9, 0, Math.PI * 2);
        g.fill();
        g.font = '700 22px system-ui, sans-serif';
        g.fillText('LIVE', 40, 42);
      }),
    [accent],
  );
  const sweep = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (sweep.current) sweep.current.rotation.z = -clock.elapsedTime * 1.4;
  });
  return (
    <group scale={0.92}>
      <group position={[0, 0.05, 0]} rotation={[-0.35, 0.5, 0.08]}>
        <RoundedBox args={[1.35, 0.86, 0.05]} radius={0.04}>
          <meshPhysicalMaterial color="#121826" metalness={0.85} roughness={0.22} clearcoat={1} />
        </RoundedBox>
        <mesh position={[0, 0, 0.027]}>
          <planeGeometry args={[1.24, 0.76]} />
          <meshBasicMaterial map={screen} toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0.62, 0.42, 0.2]}>
        <torusGeometry args={[0.15, 0.01, 8, 28]} />
        <meshBasicMaterial color={accent} toneMapped={false} transparent opacity={0.45} />
      </mesh>
      <group position={[0.62, 0.42, 0.24]} ref={sweep}>
        <mesh position={[0.07, 0, 0]}>
          <boxGeometry args={[0.14, 0.018, 0.018]} />
          <meshBasicMaterial color={accent} toneMapped={false} />
        </mesh>
      </group>
      <mesh position={[0, -0.52, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.28, 12]} />
        <Chrome />
      </mesh>
      <mesh position={[0, -0.68, 0]}>
        <cylinderGeometry args={[0.28, 0.32, 0.04, 24]} />
        <Chrome />
      </mesh>
    </group>
  );
}

function Model({ id, accent }: { id: WhyId; accent: string }) {
  switch (id) {
    case 'fast':
      return <Bolt />;
    case 'connected':
      return <Links accent={accent} />;
    case 'online':
      return <Signal accent={accent} />;
    case 'currency':
      return <Coins />;
    case 'credit':
      return <CreditCard accent={accent} />;
    default:
      return <Dashboard accent={accent} />;
  }
}

export function WhyMark3D({ id, index, pointer }: { id: WhyId; index: number; pointer: { current: IconPointer } }) {
  const slot = useRef<HTMLElement | THREE.Group>(null);
  return (
    <View ref={slot} className="zw-why__3d">
      <IconStage slot={slot} pointer={pointer} index={index} accent={ACCENT[id]}>
        <Model id={id} accent={ACCENT[id]} />
      </IconStage>
    </View>
  );
}
