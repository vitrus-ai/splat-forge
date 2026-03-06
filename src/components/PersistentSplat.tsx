/**
 * PersistentSplat: Gaussian splats via Spark (https://sparkjs.dev) with React Three Fiber.
 * Loads .ply or .splat from URL; Spark auto-detects format.
 */

import * as React from "react";
import { extend, useThree } from "@react-three/fiber";
import {
  SplatMesh as SparkSplatMesh,
  SparkRenderer as SparkSparkRenderer,
} from "@sparkjsdev/spark";

extend({ SplatMesh: SparkSplatMesh, SparkRenderer: SparkSparkRenderer });

declare global {
  namespace JSX {
    interface IntrinsicElements {
      splatMesh: Record<string, unknown>;
      sparkRenderer: Record<string, unknown>;
    }
  }
}

export interface PersistentSplatProps {
  src: string;
  alphaTest?: number;
  opacity?: number;
  [key: string]: unknown;
}

type SparkSplatMeshInstance = InstanceType<typeof SparkSplatMesh>;

const PersistentSplat = React.forwardRef<unknown, PersistentSplatProps>(
  function PersistentSplat({ src, alphaTest = 0, opacity = 1, ...props }, ref) {
    const meshRef = React.useRef<SparkSplatMeshInstance | null>(null);
    React.useImperativeHandle(ref, () => meshRef.current);
    const srcUrl = typeof src === "string" ? src : "";
    const constructorArgs = React.useMemo(
      () => {
        let fileType: any = undefined;
        const urlWithoutQuery = srcUrl.split("?")[0];
        if (urlWithoutQuery.endsWith(".splat")) fileType = "splat";
        else if (urlWithoutQuery.endsWith(".spz")) fileType = "spz";
        else if (urlWithoutQuery.endsWith(".ply")) fileType = "ply";
        return [{
          url: srcUrl,
          ...(fileType ? { fileType } : {}),
        }];
      },
      [srcUrl]
    );
    return (
      <group rotation={[Math.PI, 0, 0]}>
        {React.createElement("splatMesh" as unknown as React.ElementType, {
          ref: meshRef,
          args: constructorArgs,
          opacity,
          alphaTest,
          ...props,
        })}
      </group>
    );
  }
);

export { PersistentSplat };

function SparkRendererR3FMinimal() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const sparkRef = React.useRef<SparkSparkRenderer | null>(null);
  if (!sparkRef.current) {
    sparkRef.current = new SparkSparkRenderer({ renderer: gl });
  }
  const spark = sparkRef.current;
  spark.renderer = gl;
  spark.defaultView.camera = camera;
  spark.defaultView.autoUpdate = true;
  spark.autoViewpoints = [spark.defaultView];
  return <primitive object={spark} />;
}

export { SparkRendererR3FMinimal };
