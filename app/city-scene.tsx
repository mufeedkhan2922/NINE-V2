"use client";

import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  PerspectiveCamera,
  Float,
  Environment,
} from "@react-three/drei";
import { useState } from "react";
import * as THREE from "three";

type BuildingProps = {
  position: [number, number, number];
  height: number;
  width: number;
  color: string;
  selected: boolean;
  onClick: () => void;
};

function Building({
  position,
  height,
  width,
  color,
  selected,
  onClick,
}: BuildingProps) {
  const [hovered, setHovered] = useState(false);

  const glow =
    selected || hovered
      ? 2.8
      : 1.2;

  return (
    <group
      position={position}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerOver={() =>
        setHovered(true)
      }
      onPointerOut={() =>
        setHovered(false)
      }
    >
      {/* Main tower */}
      <mesh
        position={[
          0,
          height / 2,
          0,
        ]}
      >
        <boxGeometry
          args={[
            width,
            height,
            width,
          ]}
        />

        <meshStandardMaterial
          color={
            selected
              ? "#182b3f"
              : "#08121e"
          }
          metalness={0.8}
          roughness={0.28}
          emissive={color}
          emissiveIntensity={
            selected
              ? 0.35
              : 0.08
          }
        />
      </mesh>

      {/* Vertical glowing core */}
      <mesh
        position={[
          0,
          height / 2,
          width / 2 + 0.025,
        ]}
      >
        <boxGeometry
          args={[
            width * 0.13,
            height * 0.82,
            0.04,
          ]}
        />

        <meshBasicMaterial
          color={color}
          transparent
          opacity={
            selected
              ? 1
              : 0.6
          }
        />
      </mesh>

      {/* Windows */}
      {Array.from({
        length:
          Math.floor(
            height / 0.55
          ),
      }).map((_, i) => (
        <mesh
          key={i}
          position={[
            0,
            0.35 +
              i * 0.55,
            width / 2 + 0.04,
          ]}
        >
          <boxGeometry
            args={[
              width * 0.55,
              0.08,
              0.025,
            ]}
          />

          <meshBasicMaterial
            color={color}
            transparent
            opacity={
              selected
                ? 0.9
                : 0.38
            }
          />
        </mesh>
      ))}

      {/* Rooftop */}
      <mesh
        position={[
          0,
          height + 0.08,
          0,
        ]}
      >
        <boxGeometry
          args={[
            width * 1.05,
            0.12,
            width * 1.05,
          ]}
        />

        <meshStandardMaterial
          color="#101c2b"
          emissive={color}
          emissiveIntensity={0.35}
        />
      </mesh>

      {/* Beacon */}
      <pointLight
        position={[
          0,
          height + 0.5,
          0,
        ]}
        color={color}
        intensity={glow}
        distance={5}
      />

      {/* Selection label panel */}
      {selected && (
        <Float
          speed={2}
          rotationIntensity={0}
          floatIntensity={0.2}
        >
          <group
            position={[
              0,
              height + 1.2,
              0,
            ]}
          >
            <mesh>
              <planeGeometry
                args={[
                  2.1,
                  0.42,
                ]}
              />

              <meshBasicMaterial
                color="#06101b"
                transparent
                opacity={0.92}
                side={
                  THREE.DoubleSide
                }
              />
            </mesh>
          </group>
        </Float>
      )}
    </group>
  );
}

function CentralTower({
  selected,
  onClick,
}: {
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <group
      position={[0, 0, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <mesh
        position={[0, 2.7, 0]}
      >
        <cylinderGeometry
          args={[
            1.15,
            1.35,
            5.4,
            8,
          ]}
        />

        <meshStandardMaterial
          color="#0b1725"
          metalness={0.9}
          roughness={0.22}
          emissive="#37d7ff"
          emissiveIntensity={
            selected
              ? 0.45
              : 0.18
          }
        />
      </mesh>

      <mesh
        position={[0, 5.48, 0]}
      >
        <cylinderGeometry
          args={[
            0.28,
            0.28,
            0.7,
            16,
          ]}
        />

        <meshBasicMaterial
          color="#62e9ff"
        />
      </mesh>

      <pointLight
        position={[0, 5.8, 0]}
        color="#39dcff"
        intensity={
          selected ? 8 : 4
        }
        distance={12}
      />

      <mesh
        position={[
          0,
          2.7,
          1.38,
        ]}
      >
        <boxGeometry
          args={[
            0.08,
            4.4,
            0.04,
          ]}
        />

        <meshBasicMaterial
          color="#5de6ff"
        />
      </mesh>
    </group>
  );
}

function Ground() {
  return (
    <group>
      <mesh
        rotation={[
          -Math.PI / 2,
          0,
          0,
        ]}
        position={[
          0,
          -0.05,
          0,
        ]}
      >
        <planeGeometry
          args={[35, 35]}
        />

        <meshStandardMaterial
          color="#02060b"
          metalness={0.7}
          roughness={0.55}
        />
      </mesh>

      {/* City grid */}
      {Array.from({
        length: 17,
      }).map((_, i) => {
        const p =
          -12 + i * 1.5;

        return (
          <group key={i}>
            <mesh
              rotation={[
                -Math.PI / 2,
                0,
                0,
              ]}
              position={[
                p,
                0.01,
                0,
              ]}
            >
              <planeGeometry
                args={[
                  0.012,
                  28,
                ]}
              />

              <meshBasicMaterial
                color="#0b5368"
                transparent
                opacity={0.4}
              />
            </mesh>

            <mesh
              rotation={[
                -Math.PI / 2,
                0,
                0,
              ]}
              position={[
                0,
                0.01,
                p,
              ]}
            >
              <planeGeometry
                args={[
                  28,
                  0.012,
                ]}
              />

              <meshBasicMaterial
                color="#0b5368"
                transparent
                opacity={0.4}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function City({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <ambientLight
        intensity={0.35}
      />

      <directionalLight
        position={[5, 10, 5]}
        intensity={1.2}
      />

      <Ground />

      <CentralTower
        selected={
          selected === "central"
        }
        onClick={() =>
          onSelect("central")
        }
      />

      <Building
        position={[-4.2, 0, -1]}
        height={3.6}
        width={1.45}
        color="#31d7ff"
        selected={
          selected === "market"
        }
        onClick={() =>
          onSelect("market")
        }
      />

      <Building
        position={[4.2, 0, -1]}
        height={4.3}
        width={1.6}
        color="#8c7cff"
        selected={
          selected === "analysis"
        }
        onClick={() =>
          onSelect("analysis")
        }
      />

      <Building
        position={[-3.2, 0, 4]}
        height={2.8}
        width={1.35}
        color="#ff597b"
        selected={
          selected === "risk"
        }
        onClick={() =>
          onSelect("risk")
        }
      />

      <Building
        position={[3.4, 0, 4.2]}
        height={3.2}
        width={1.35}
        color="#54e69c"
        selected={
          selected === "news"
        }
        onClick={() =>
          onSelect("news")
        }
      />

      <Building
        position={[0, 0, -5]}
        height={2.2}
        width={1.2}
        color="#ffc857"
        selected={
          selected === "execution"
        }
        onClick={() =>
          onSelect("execution")
        }
      />

      {/* Atmospheric particles */}
      <points>
        <sphereGeometry
          args={[14, 32, 32]}
        />

        <pointsMaterial
          color="#38cfff"
          size={0.018}
          transparent
          opacity={0.35}
        />
      </points>
    </>
  );
}

export default function CityScene({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Canvas
      dpr={[1, 1.6]}
      gl={{
        antialias: true,
        alpha: true,
      }}
    >
      <PerspectiveCamera
        makeDefault
        position={[
          11,
          10,
          13,
        ]}
        fov={42}
      />

      <Environment preset="night" />

      <City
        selected={selected}
        onSelect={onSelect}
      />

      <OrbitControls
        enablePan={false}
        minDistance={8}
        maxDistance={22}
        minPolarAngle={
          Math.PI / 4
        }
        maxPolarAngle={
          Math.PI / 2.15
        }
        target={[
          0,
          1.5,
          0,
        ]}
      />
    </Canvas>
  );
}