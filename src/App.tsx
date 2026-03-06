/**
 * SplatForge – Video-to-Gaussian-Splat pipeline UI.
 * Setup: single column (Input, Output, Generate Splat, Open Splat). Processing: full-screen panel with timer, segmented progress, logs.
 */

import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as tauriOpen, save as tauriSave } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewport, Line } from "@react-three/drei";
import * as THREE from "three";
import { PersistentSplat, SparkRendererR3FMinimal } from "@/components/PersistentSplat";
import { WorldGen } from "@/components/WorldGen";
import { Home } from "@/components/Home";
import type { RecentProject } from "@/components/Home";
import { MediaProject } from "@/components/MediaProject";
import forgeSpzUrl from "@/visuals/forge.spz?url";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { Video, FolderOpen, Play, FileUp, Move, RotateCw, Crop, MousePointer2, Save, Check, Paintbrush } from "lucide-react";

const OUTPUT_DIR_KEY = "splatforge_output_dir";

type PipelineStage = "idle" | "ffmpeg" | "colmap" | "brush" | "difix_enhance" | "brush_finetune" | "convert";
type InitStage = "checking" | "missing_deps" | "running_setup" | "ready";

interface ProgressState {
  stage: PipelineStage;
  message?: string;
}

const STAGES: PipelineStage[] = ["ffmpeg", "colmap", "brush", "difix_enhance", "brush_finetune", "convert"];
const SEGMENT_LABELS = ["Parsing Images", "Camera Poses", "Base Gaussian", "Difix3D+ Diffusion", "Fine-Tuning", "Exporting Splat"];

function defaultOutputFilename(): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").replace(" ", "_");
  const short = crypto.randomUUID().slice(0, 8);
  return `splat_${ts}_${short}.ply`;
}

function basename(path: string): string {
  const p = path.replace(/\/$/, "");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** WASD = FPS move (camera only). Arrows = orbit around current view center. */
const WASD_MOVE_SPEED = 0.15;
const ARROW_ORBIT_SPEED = 2.4;

function FloatingGlitchSplat() {
  const groupRef = React.useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.005;
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 1.5) * 0.1;
    }
  });

  return (
    <group ref={groupRef} scale={[1, 1, 1]}>
      <SparkRendererR3FMinimal />
      <PersistentSplat src={forgeSpzUrl} opacity={0.8} />
    </group>
  );
}

function CropBoxVisuals() {
  const cornersRef = React.useRef<THREE.Group>(null);
  const linesRef = React.useRef<THREE.Group>(null);
  const [scale, setScale] = React.useState<[number, number, number]>([1, 1, 1]);

  useFrame(() => {
    if (cornersRef.current && cornersRef.current.parent) {
      const parentScale = cornersRef.current.parent.scale;
      
      cornersRef.current.scale.set(1 / parentScale.x, 1 / parentScale.y, 1 / parentScale.z);
      if (linesRef.current) {
        linesRef.current.scale.set(1 / parentScale.x, 1 / parentScale.y, 1 / parentScale.z);
      }
      
      const extX = parentScale.x * 0.5;
      const extY = parentScale.y * 0.5;
      const extZ = parentScale.z * 0.5;

      let i = 0;
      for (const x of [-1, 1]) {
        for (const y of [-1, 1]) {
          for (const z of [-1, 1]) {
            const child = cornersRef.current.children[i];
            if (child) {
              child.position.set(x * extX, y * extY, z * extZ);
            }
            i++;
          }
        }
      }

      if (
        Math.abs(scale[0] - parentScale.x) > 0.001 ||
        Math.abs(scale[1] - parentScale.y) > 0.001 ||
        Math.abs(scale[2] - parentScale.z) > 0.001
      ) {
        setScale([parentScale.x, parentScale.y, parentScale.z]);
      }
    }
  });

  const [sx, sy, sz] = scale;
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;

  return (
    <>
      <group ref={linesRef}>
        <Line
          points={[
            [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, -hz],
            [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz],
          ]}
          color="#fbbf24"
          lineWidth={4}
          dashed
          dashScale={1}
          dashSize={0.05}
          gapSize={0.05}
        />
        <Line
          points={[
            [-hx, -hy, -hz], [-hx, -hy, hz],
            [hx, -hy, -hz], [hx, -hy, hz],
            [hx, hy, -hz], [hx, hy, hz],
            [-hx, hy, -hz], [-hx, hy, hz]
          ]}
          color="#fbbf24"
          lineWidth={4}
          dashed
          dashScale={1}
          dashSize={0.05}
          gapSize={0.05}
          segments
        />
      </group>

      <group ref={cornersRef}>
        {/* 8 corners */}
        {[-1, 1].map((x) =>
          [-1, 1].map((y) =>
            [-1, 1].map((z) => (
              <group key={`corner-${x}-${y}-${z}`}>
                {/* 3 lines per corner to form a bracket */}
                <Line points={[[0, 0, 0], [-x * 0.15, 0, 0]]} color="#fbbf24" lineWidth={4} />
                <Line points={[[0, 0, 0], [0, -y * 0.15, 0]]} color="#fbbf24" lineWidth={4} />
                <Line points={[[0, 0, 0], [0, 0, -z * 0.15]]} color="#fbbf24" lineWidth={4} />
              </group>
            ))
          )
        )}
      </group>
    </>
  );
}
function KeyboardCameraControls({
  controlsRef,
}: {
  controlsRef: React.RefObject<any>;
}) {
  const keys = React.useRef({
    w: false,
    a: false,
    s: false,
    d: false,
    arrowLeft: false,
    arrowRight: false,
    arrowUp: false,
    arrowDown: false,
  });
  const { camera } = useThree();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      if (k === "w") keys.current.w = down;
      else if (k === "a") keys.current.a = down;
      else if (k === "s") keys.current.s = down;
      else if (k === "d") keys.current.d = down;
      else if (e.key === "ArrowLeft") keys.current.arrowLeft = down;
      else if (e.key === "ArrowRight") keys.current.arrowRight = down;
      else if (e.key === "ArrowUp") keys.current.arrowUp = down;
      else if (e.key === "ArrowDown") keys.current.arrowDown = down;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      onKey(e, true);
    };
    const onKeyUp = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const fwd = React.useRef(new THREE.Vector3());
  const right = React.useRef(new THREE.Vector3());
  const vTemp = React.useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const dt = delta * 60;

    // WASD: FPS-style move — translate BOTH camera and target so you can walk around
    const { w, a, s, d, arrowLeft, arrowRight, arrowUp, arrowDown } = keys.current;
    if (w || a || s || d) {
      fwd.current.setFromMatrixColumn(camera.matrix, 2).negate();
      fwd.current.normalize();
      right.current.setFromMatrixColumn(camera.matrix, 0);
      right.current.normalize();
      const move = vTemp.current.set(0, 0, 0);
      if (w) move.add(fwd.current);
      if (s) move.sub(fwd.current);
      if (d) move.add(right.current);
      if (a) move.sub(right.current);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(WASD_MOVE_SPEED * dt);
        camera.position.add(move);
        // Move the target too, so the orbit center moves with you (FPS style)
        if (ctrl && (ctrl as any).target) {
          (ctrl as any).target.add(move);
        }
      }
    }

    // Arrows: orbit camera around current view center via OrbitControls API
    const orbitCtrl = controlsRef.current as { getAzimuthalAngle?: () => number; setAzimuthalAngle?: (a: number) => void; getPolarAngle?: () => number; setPolarAngle?: (a: number) => void } | null;
    if ((arrowLeft || arrowRight || arrowUp || arrowDown) && orbitCtrl?.setAzimuthalAngle && orbitCtrl?.setPolarAngle) {
      const d = ARROW_ORBIT_SPEED * dt * (Math.PI / 180);
      if (arrowLeft) orbitCtrl.setAzimuthalAngle!(orbitCtrl.getAzimuthalAngle!() + d);
      if (arrowRight) orbitCtrl.setAzimuthalAngle!(orbitCtrl.getAzimuthalAngle!() - d);
      if (arrowUp) orbitCtrl.setPolarAngle!(Math.max(0.05, orbitCtrl.getPolarAngle!() - d));
      if (arrowDown) orbitCtrl.setPolarAngle!(Math.min(Math.PI - 0.05, orbitCtrl.getPolarAngle!() + d));
    }
  });

  return null;
}

interface HistoryEntry {
  path: string;
  splatPos: [number, number, number];
  splatRot: [number, number, number];
  innerPos: [number, number, number];
  innerRot: [number, number, number, number]; // quaternion
}

const App: React.FC = () => {
  const [initStage, setInitStage] = React.useState<InitStage>("checking");
  const [missingDeps, setMissingDeps] = React.useState<string[]>([]);
  const [setupLogs, setSetupLogs] = React.useState<string[]>([]);
  const setupLogsEndRef = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pipelineError, setPipelineError] = React.useState<string | null>(null);

  React.useEffect(() => {
    invoke<string[]>("check_dependencies")
      .then((missing) => {
        if (missing.length > 0) {
          setMissingDeps(missing);
          setInitStage("missing_deps");
        } else {
          setInitStage("ready");
        }
      })
      .catch((e) => {
        console.error("Dependency check failed:", e);
        // Fallback to ready if we can't check
        setInitStage("ready");
      });
  }, []);

  React.useEffect(() => {
    if (setupLogs.length) setupLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [setupLogs]);

  const handleRunSetup = async () => {
    setInitStage("running_setup");
    setSetupLogs([]);
    const unlisten = await listen<string>("setup-log", (e) => {
      setSetupLogs((prev) => [...prev, e.payload]);
    });
    try {
      await invoke("run_setup_script");
      const stillMissing = await invoke<string[]>("check_dependencies");
      if (stillMissing.length > 0) {
        setMissingDeps(stillMissing);
        setInitStage("missing_deps");
        setError("Setup finished but dependencies are still missing: " + stillMissing.join(", "));
      } else {
        setInitStage("ready");
      }
    } catch (e) {
      setInitStage("missing_deps");
      setPipelineError(e instanceof Error ? e.message : String(e));
    } finally {
      unlisten();
    }
  };

  const [inputPath, setInputPath] = React.useState("");
  const [isVideo, setIsVideo] = React.useState(true);
  const [outputDir, setOutputDir] = React.useState(() => {
    try {
      return localStorage.getItem(OUTPUT_DIR_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [outputFilename, setOutputFilename] = React.useState("");
  const [useDifix, setUseDifix] = React.useState(true);
  const [useBgRemoval, setUseBgRemoval] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [progress, setProgress] = React.useState<ProgressState>({ stage: "idle" });
  const [resultSplatPath, setResultSplatPath] = React.useState<string | null>(null);
  const [resultSplatSize, setResultSplatSize] = React.useState<number | null>(null);
  const [activeCreateTab, setActiveCreateTab] = React.useState<"files" | "ai">("files");
  const [activeScreen, setActiveScreen] = React.useState<"home" | "media_project" | "worldgen" | "preview">("home");
  const [recentProjects, setRecentProjects] = React.useState<RecentProject[]>(() => {
    try {
      const stored = localStorage.getItem("splatforge_recent_projects");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const addRecentProject = React.useCallback(async (path: string) => {
    try {
      const size = await invoke<number>("get_file_size", { path });
      setRecentProjects(prev => {
        const filtered = prev.filter(p => p.path !== path);
        const newProject: RecentProject = {
          path,
          name: basename(path),
          sizeBytes: size,
          timestamp: Date.now()
        };
        const updated = [newProject, ...filtered].slice(0, 10);
        localStorage.setItem("splatforge_recent_projects", JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      console.error("Failed to add recent project:", e);
    }
  }, []);
  
  // Editor State
  const [isEditMode, setIsEditMode] = React.useState(false);
  const [activeTool, setActiveTool] = React.useState<"select" | "move" | "rotate" | "crop" | "brush">("select");
  const [selectedElement, setSelectedElement] = React.useState<"splat" | "cropBox">("splat");
  
  // Brush State
  const [strokes, setStrokes] = React.useState<Array<Array<{x: number, y: number}>>>([]);
  const [currentStroke, setCurrentStroke] = React.useState<Array<{x: number, y: number}> | null>(null);
  const [brushSize, setBrushSize] = React.useState(30);
  const svgOverlayRef = React.useRef<HTMLDivElement>(null);
  
  const [splatPos, setSplatPos] = React.useState<[number, number, number]>([0, 0, 0]);
  const [splatRot, setSplatRot] = React.useState<[number, number, number]>([0, 0, 0]);
  
  const [splatTarget, setSplatTarget] = React.useState<THREE.Group | null>(null);
  const [cropBoxTarget, setCropBoxTarget] = React.useState<THREE.Group | null>(null);
  const [hasInitCropBox, setHasInitCropBox] = React.useState(false);

  const persistentSplatRef = React.useRef<any>(null);

  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);

  const saveHistoryState = React.useCallback((path: string, spPos: [number,number,number], spRot: [number,number,number], ip: [number,number,number], iq: [number,number,number,number]) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push({
        path,
        splatPos: spPos,
        splatRot: spRot,
        innerPos: ip,
        innerRot: iq
      });
      setHistoryIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [historyIndex]);

  const loadHistoryState = React.useCallback((index: number) => {
    if (index < 0 || index >= history.length) return;
    const entry = history[index];
    setResultSplatPath(entry.path);
    setSplatPos(entry.splatPos);
    setSplatRot(entry.splatRot);
    
    if (splatTarget) {
      splatTarget.position.set(...entry.splatPos);
      splatTarget.rotation.set(...entry.splatRot);
    }
    
    if (innerSplatRef.current) {
      innerSplatRef.current.position.set(...entry.innerPos);
      innerSplatRef.current.quaternion.set(...entry.innerRot);
    }
    
    setHistoryIndex(index);
  }, [history, splatTarget]);

  // Push initial state when entering edit mode if empty
  React.useEffect(() => {
    if (isEditMode && history.length === 0 && resultSplatPath && innerSplatRef.current && splatTarget) {
      saveHistoryState(
        resultSplatPath,
        [splatTarget.position.x, splatTarget.position.y, splatTarget.position.z],
        [splatTarget.rotation.x, splatTarget.rotation.y, splatTarget.rotation.z],
        [innerSplatRef.current.position.x, innerSplatRef.current.position.y, innerSplatRef.current.position.z],
        [innerSplatRef.current.quaternion.x, innerSplatRef.current.quaternion.y, innerSplatRef.current.quaternion.z, innerSplatRef.current.quaternion.w]
      );
    }
  }, [isEditMode, resultSplatPath, splatTarget, history.length, saveHistoryState]);

  // Initialize Crop Box to match Splat bounds once loaded
  React.useEffect(() => {
    if (isEditMode && splatTarget && cropBoxTarget && !hasInitCropBox) {
      // Small timeout to allow splat mesh to initialize and compute bounds internally
      const timer = setTimeout(() => {
        const box = new THREE.Box3().setFromObject(splatTarget);
        if (!box.isEmpty()) {
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          
          // Add some padding to avoid clipping
          size.multiplyScalar(1.05);
          
          // Ensure min size just in case
          size.x = Math.max(size.x, 1);
          size.y = Math.max(size.y, 1);
          size.z = Math.max(size.z, 1);
          
          cropBoxTarget.position.copy(center);
          cropBoxTarget.scale.copy(size);
          cropBoxTarget.rotation.set(0, 0, 0); // Bounding box is axis-aligned
        } else {
          // Fallback if bounds are empty (e.g. not fully loaded)
          cropBoxTarget.position.set(0, 0, 0);
          cropBoxTarget.scale.set(5, 5, 5);
        }
        setHasInitCropBox(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isEditMode, splatTarget, cropBoxTarget, hasInitCropBox]);
  
  const innerSplatRef = React.useRef<THREE.Group>(null);
  const isShiftDown = React.useRef(false);
  const initialInnerWorldMatrix = React.useRef(new THREE.Matrix4());
  const isEditingPivot = React.useRef(false);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftDown.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftDown.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    }
  }, []);

  const handleTransformChange = React.useCallback(() => {
    if (splatTarget) {
      if (isEditingPivot.current && innerSplatRef.current) {
        splatTarget.updateMatrixWorld();
        const parentInv = new THREE.Matrix4().copy(splatTarget.matrixWorld).invert();
        const newLocal = new THREE.Matrix4().multiplyMatrices(parentInv, initialInnerWorldMatrix.current);
        
        const pos = new THREE.Vector3();
        const rot = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        newLocal.decompose(pos, rot, scale);
        
        innerSplatRef.current.position.copy(pos);
        innerSplatRef.current.quaternion.copy(rot);
      }

      setSplatPos([
        splatTarget.position.x,
        splatTarget.position.y,
        splatTarget.position.z,
      ]);
      setSplatRot([
        splatTarget.rotation.x,
        splatTarget.rotation.y,
        splatTarget.rotation.z,
      ]);
    }
  }, [splatTarget]);

  const handleApplyBrush = React.useCallback(async () => {
    if (!resultSplatPath || strokes.length === 0 || !persistentSplatRef.current) return;
    const camera = orbitControlsRef.current?.object as THREE.PerspectiveCamera;
    if (!camera) return;

    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const viewMatrix = camera.matrixWorldInverse;
    const projMatrix = camera.projectionMatrix;
    const splatMatrix = persistentSplatRef.current.matrixWorld;

    const totalMatrix = new THREE.Matrix4()
      .copy(projMatrix)
      .multiply(viewMatrix)
      .multiply(splatMatrix);

    let screenWidth = window.innerWidth;
    let screenHeight = window.innerHeight;
    if (svgOverlayRef.current) {
      screenWidth = svgOverlayRef.current.clientWidth;
      screenHeight = svgOverlayRef.current.clientHeight;
    }

    // Convert strokes to flat arrays to pass to Rust easily
    const flatStrokes = strokes.map(stroke => stroke.map(p => [p.x, p.y]));

    try {
      const brushedPath = await invoke<string>("apply_brush", {
        inputPath: resultSplatPath,
        totalMatrix: Array.from(totalMatrix.elements),
        screenWidth,
        screenHeight,
        strokes: flatStrokes,
        brushSize
      });
      
      setResultSplatPath(brushedPath);
      setStrokes([]);
      
      if (innerSplatRef.current && splatTarget) {
        saveHistoryState(
          brushedPath,
          [splatTarget.position.x, splatTarget.position.y, splatTarget.position.z],
          [splatTarget.rotation.x, splatTarget.rotation.y, splatTarget.rotation.z],
          [innerSplatRef.current.position.x, innerSplatRef.current.position.y, innerSplatRef.current.position.z],
          [innerSplatRef.current.quaternion.x, innerSplatRef.current.quaternion.y, innerSplatRef.current.quaternion.z, innerSplatRef.current.quaternion.w]
        );
      }
    } catch (e) {
      alert("Failed to brush: " + String(e));
    }
  }, [resultSplatPath, strokes, brushSize, splatTarget, saveHistoryState]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== "brush") return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCurrentStroke([{ x: e.clientX - rect.left, y: e.clientY - rect.top }]);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== "brush" || !currentStroke) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCurrentStroke(prev => [...(prev || []), { x: e.clientX - rect.left, y: e.clientY - rect.top }]);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== "brush" || !currentStroke) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setStrokes(prev => [...prev, currentStroke]);
    setCurrentStroke(null);
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isEditMode) return;
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            loadHistoryState(historyIndex + 1); // Redo
          } else {
            loadHistoryState(historyIndex - 1); // Undo
          }
        }
      }
      
      // Brush tool shortcuts
      if (activeTool === "brush") {
        if (e.key === "Enter" || e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          handleApplyBrush();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setStrokes([]);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditMode, historyIndex, loadHistoryState, activeTool, handleApplyBrush, setStrokes]);

  const handleApplyCrop = async () => {
    if (!resultSplatPath || !splatTarget || !cropBoxTarget || !persistentSplatRef.current) return;
    
    splatTarget.updateMatrixWorld(true);
    cropBoxTarget.updateMatrixWorld(true);

    const fullSplatMatrix = persistentSplatRef.current.matrixWorld;
    
    const invCropMatrix = new THREE.Matrix4().copy(cropBoxTarget.matrixWorld).invert();

    try {
      const croppedPath = await invoke<string>("apply_crop", {
        inputPath: resultSplatPath,
        splatMatrix: Array.from(fullSplatMatrix.elements),
        invCropMatrix: Array.from(invCropMatrix.elements)
      });
      setResultSplatPath(croppedPath);
      
      if (innerSplatRef.current) {
        saveHistoryState(
          croppedPath,
          [splatTarget.position.x, splatTarget.position.y, splatTarget.position.z],
          [splatTarget.rotation.x, splatTarget.rotation.y, splatTarget.rotation.z],
          [innerSplatRef.current.position.x, innerSplatRef.current.position.y, innerSplatRef.current.position.z],
          [innerSplatRef.current.quaternion.x, innerSplatRef.current.quaternion.y, innerSplatRef.current.quaternion.z, innerSplatRef.current.quaternion.w]
        );
      }
    } catch (e) {
      alert("Failed to crop: " + String(e));
    }
  };

  const handleSaveSplat = async () => {
    if (!resultSplatPath || !splatTarget || !persistentSplatRef.current) return;
    
    const savePath = await tauriSave({
      title: "Save Splat",
      filters: [{ name: "Splat Formats", extensions: ["splat", "ply", "spz"] }],
      defaultPath: resultSplatPath.replace(/(\.splat|\.ply|\.spz)$/i, "_edited$1")
    });

    if (!savePath) return;

    splatTarget.updateMatrixWorld(true);

    const finalMatrix = persistentSplatRef.current.matrixWorld;

    const finalPos = new THREE.Vector3();
    const finalQuat = new THREE.Quaternion();
    const finalScale = new THREE.Vector3();
    finalMatrix.decompose(finalPos, finalQuat, finalScale);
    const finalEuler = new THREE.Euler().setFromQuaternion(finalQuat, 'XYZ');

    try {
      await invoke("save_splat", {
        inputPath: resultSplatPath,
        outputPath: savePath,
        bakeTransform: true,
        tx: finalPos.x,
        ty: finalPos.y,
        tz: finalPos.z,
        rx: THREE.MathUtils.radToDeg(finalEuler.x),
        ry: THREE.MathUtils.radToDeg(finalEuler.y),
        rz: THREE.MathUtils.radToDeg(finalEuler.z),
        scale: finalScale.x
      });
      alert("Successfully saved to: " + savePath);
    } catch (e) {
      alert("Failed to save: " + String(e));
    }
  };

  const handleDragStart = React.useCallback(() => {
    if (isShiftDown.current && (activeTool === 'move' || activeTool === 'rotate')) {
      isEditingPivot.current = true;
      if (innerSplatRef.current) {
        innerSplatRef.current.updateMatrixWorld();
        initialInnerWorldMatrix.current.copy(innerSplatRef.current.matrixWorld);
      }
    } else {
      isEditingPivot.current = false;
    }
  }, [activeTool]);

  const handleDragEnd = React.useCallback(() => {
    isEditingPivot.current = false;
    if (resultSplatPath && innerSplatRef.current && splatTarget) {
      saveHistoryState(
        resultSplatPath,
        [splatTarget.position.x, splatTarget.position.y, splatTarget.position.z],
        [splatTarget.rotation.x, splatTarget.rotation.y, splatTarget.rotation.z],
        [innerSplatRef.current.position.x, innerSplatRef.current.position.y, innerSplatRef.current.position.z],
        [innerSplatRef.current.quaternion.x, innerSplatRef.current.quaternion.y, innerSplatRef.current.quaternion.z, innerSplatRef.current.quaternion.w]
      );
    }
  }, [resultSplatPath, saveHistoryState, splatTarget]);

  const updatePos = (axisIndex: number, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const newPos = [...splatPos] as [number, number, number];
    newPos[axisIndex] = num;
    setSplatPos(newPos);
    if (splatTarget) {
      const axes = ['x', 'y', 'z'] as const;
      splatTarget.position[axes[axisIndex]] = num;
    }
  };

  const updateRot = (axisIndex: number, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const rad = num * (Math.PI / 180);
    const newRot = [...splatRot] as [number, number, number];
    newRot[axisIndex] = rad;
    setSplatRot(newRot);
    if (splatTarget) {
      const axes = ['x', 'y', 'z'] as const;
      splatTarget.rotation[axes[axisIndex]] = rad;
    }
  };
  const [startTime, setStartTime] = React.useState<number | null>(null);
  const logsEndRef = React.useRef<HTMLDivElement>(null);
  const orbitControlsRef = React.useRef<any>(null);

  React.useEffect(() => {
    try {
      if (outputDir) localStorage.setItem(OUTPUT_DIR_KEY, outputDir);
    } catch {}
  }, [outputDir]);

  React.useEffect(() => {
    if (logs.length) logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  React.useEffect(() => {
    // Listen for file drops anywhere in the window
    const unlistenPromise = listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      if (e.payload.paths && e.payload.paths.length > 0) {
        const path = e.payload.paths[0];
        if (path.endsWith(".splat") || path.endsWith(".ply") || path.endsWith(".spz")) {
          setResultSplatPath(path);
          addRecentProject(path);
          setActiveScreen("preview");
        }
      }
    });
    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [addRecentProject]);

  React.useEffect(() => {
    if (!resultSplatPath) {
      setResultSplatSize(null);
      return;
    }
    invoke<number>("get_file_size", { path: resultSplatPath })
      .then(setResultSplatSize)
      .catch(() => setResultSplatSize(null));
  }, [resultSplatPath]);

  const handleSelectVideo = React.useCallback(async () => {
    const selected = await tauriOpen({
      directory: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv"] }],
    });
    if (selected == null) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    setInputPath(path);
    setIsVideo(true);
    setError(null);
    setPipelineError(null);
  }, []);

  const handleSelectImageFolder = React.useCallback(async () => {
    const selected = await tauriOpen({ directory: true });
    if (selected == null) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    setInputPath(path);
    setIsVideo(false);
    setError(null);
    setPipelineError(null);
  }, []);

  const handleSelectOutputDir = React.useCallback(async () => {
    const selected = await tauriOpen({ directory: true });
    if (selected == null) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    setOutputDir(path);
    if (!outputFilename) setOutputFilename(defaultOutputFilename());
  }, [outputFilename]);

  const handleOpenSplat = React.useCallback(async () => {
    const selected = await tauriOpen({
      directory: false,
      filters: [{ name: "Splat / PLY", extensions: ["splat", "ply", "spz"] }],
    });
    if (selected == null) return;
    const path = Array.isArray(selected) ? selected[0] : selected;
    setResultSplatPath(path);
    addRecentProject(path);
    setActiveScreen("preview");
  }, [addRecentProject]);

  const handleStart = React.useCallback(async (opts?: {
    inputPath: string, isVideo: boolean, outputDir: string, outputFilename: string, useDifix: boolean, useBgRemoval: boolean
  }) => {
    const finalInputPath = opts?.inputPath ?? inputPath;
    const finalOutputDir = opts?.outputDir ?? outputDir;
    const finalOutputFilename = opts?.outputFilename ?? outputFilename;
    const finalIsVideo = opts?.isVideo ?? isVideo;
    const finalUseDifix = opts?.useDifix ?? useDifix;
    const finalUseBgRemoval = opts?.useBgRemoval ?? useBgRemoval;

    if (!finalInputPath || !finalInputPath?.trim() || !finalOutputDir || !finalOutputDir?.trim()) {
      setError("Set input (video or image folder) and output folder.");
      return;
    }
    setRunning(true);
    setError(null);
    setPipelineError(null);
    setLogs([]);
    setProgress({ stage: "ffmpeg", message: "Starting…" });
    setResultSplatPath(null);
    setStartTime(Date.now());

    const unlistenLog = await listen<{ line: string }>("log-output", (e) => {
      setLogs((prev) => [...prev, e.payload.line]);
    });
    const unlistenProgress = await listen<ProgressState>("training-progress", (e) => {
      setProgress(e.payload);
    });
    const unlistenFinished = await listen<{
      success: boolean;
      output_splat_path?: string;
      error?: string;
    }>("pipeline-finished", (e) => {
      setRunning(false);
      setStartTime(null);
      if (e.payload.success && e.payload.output_splat_path) {
        setResultSplatPath(e.payload.output_splat_path);
        addRecentProject(e.payload.output_splat_path);
        setActiveScreen("preview");
      }
      if (e.payload.error) setPipelineError(e.payload.error);
      unlistenLog();
      unlistenProgress();
      unlistenFinished();
    });

    try {
      let resolvedFilename = finalOutputFilename ? finalOutputFilename?.trim() : null;
      if (resolvedFilename && !resolvedFilename.endsWith(".ply") && !resolvedFilename.endsWith(".splat") && !resolvedFilename.endsWith(".spz")) {
        resolvedFilename += ".ply";
      }

      await invoke("run_reconstruction_pipeline", {
        args: {
          inputPath: finalInputPath?.trim(),
          isVideo: finalIsVideo,
          outputDir: finalOutputDir?.trim(),
          outputFilename: resolvedFilename,
          useDifix: finalUseDifix,
          useBgRemoval: finalUseBgRemoval,
        },
      });
    } catch (e) {
      setRunning(false);
      setStartTime(null);
      setPipelineError(e instanceof Error ? e.message : String(e));
      unlistenLog();
      unlistenProgress();
      unlistenFinished();
    }
  }, [inputPath, outputDir, outputFilename, isVideo, useDifix, useBgRemoval]);

  const progressIndex = STAGES.indexOf(progress.stage);
  const canGenerate = Boolean(inputPath?.trim() && outputDir?.trim());
  const [elapsedSec, setElapsedSec] = React.useState(0);
  React.useEffect(() => {
    if (!running || startTime == null) return;
    const t = setInterval(() => setElapsedSec(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running, startTime]);

  const elapsedStr = `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;

  if (initStage !== "ready") {
    return (
      <div className="h-screen flex flex-col splatforge-app bg-background text-foreground items-center justify-center p-6">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          <Card className="splatforge-glass border-amber-500/20">
            <CardHeader>
              <CardTitle className="text-xl text-center text-amber-400/90">
                {initStage === "checking" && "Checking Dependencies..."}
                {initStage === "missing_deps" && "Missing System Libraries"}
                {initStage === "running_setup" && "Installing Dependencies"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {initStage === "checking" && (
                <p className="text-amber-200/80 text-center">Verifying required tools (FFmpeg, COLMAP, Brush)...</p>
              )}
              {initStage === "missing_deps" && (
                <>
                  <p className="text-amber-200/80 text-center">
                    The following dependencies are missing or not in PATH:
                    <br />
                    <span className="font-mono text-amber-400 font-bold">{missingDeps.join(", ")}</span>
                  </p>
                  <p className="text-sm text-amber-300/60 text-center">
                    SplatForge requires these libraries to generate splats. You can run the setup script automatically, or skip if you plan to only view existing splats.
                  </p>
                  <div className="flex justify-center gap-4 mt-2">
                    <Button onClick={() => setInitStage("ready")} variant="outline" className="border-amber-500/30 text-amber-200/90 hover:bg-amber-500/15">
                      Skip
                    </Button>
                    <Button onClick={handleRunSetup} className="bg-amber-500 text-black hover:bg-amber-400 shadow-lg shadow-amber-500/25">
                      Run Setup
                    </Button>
                  </div>
                  {error && (
                    <p className="text-red-400 text-sm bg-red-950/30 border border-red-500/30 rounded-sm px-3 py-2 mt-2">
                      {error}
                    </p>
                  )}
                </>
              )}
              {initStage === "running_setup" && (
                <div className="flex flex-col gap-3 h-[60vh]">
                  <p className="text-sm text-amber-300/80">Running setup.sh. This may take a while and could require you to interact with the system (e.g., sudo password prompt might fail in background, but we will try)...</p>
                  <ScrollArea className="splatforge-logs flex-1 rounded-sm border border-amber-500/20 bg-black/60 font-mono text-xs p-3">
                    {setupLogs.map((line, i) => (
                      <div key={i} className="text-amber-200/80 leading-relaxed break-all">
                        {line}
                      </div>
                    ))}
                    <div ref={setupLogsEndRef} />
                  </ScrollArea>
                  <div className="flex justify-end mt-2">
                    <Button onClick={() => setInitStage("ready")} variant="outline" className="border-amber-500/30 text-amber-200/90 hover:bg-amber-500/15">
                      Skip / Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col splatforge-app bg-background text-foreground">
      {running ? (
        <header className="splatforge-header border-b border-amber-500/20 px-4 py-2 flex items-center justify-between">
          <h1 className="font-semibold text-lg text-amber-400/95">SplatForge</h1>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRunning(false)}
            className="bg-white/10 text-muted-foreground hover:bg-white/20 border border-amber-500/20"
          >
            Cancel
          </Button>
        </header>
      ) : activeScreen === "preview" ? (
        <header className="splatforge-header border-b border-amber-500/20 px-4 py-2 flex items-center justify-between relative z-40">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setActiveScreen("home")}
            className="bg-white/10 text-muted-foreground hover:bg-white/20 border border-amber-500/20"
          >
            Back
          </Button>
          
          {resultSplatPath && (
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center pointer-events-none">
              <span className="text-amber-400/95 font-medium truncate" title={resultSplatPath}>
                {basename(resultSplatPath)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            {isEditMode && (
              <Button
                size="sm"
                className="bg-amber-500 text-black hover:bg-amber-400 h-8"
                onClick={handleSaveSplat}
              >
                <Save className="size-4 mr-1.5" />
                Save Splat
              </Button>
            )}
            {resultSplatSize != null && (
              <span className="text-muted-foreground text-sm tabular-nums">
                {formatFileSize(resultSplatSize)}
              </span>
            )}
          </div>
        </header>
      ) : (
        <header className="splatforge-header border-b border-amber-500/20 px-4 py-2 flex items-center justify-between">
          <h1 className="font-semibold text-lg text-amber-400/95 cursor-pointer" onClick={() => setActiveScreen("home")}>SplatForge</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveScreen("preview")}
              disabled={!resultSplatPath}
              className={cn("px-3 py-1.5 rounded-md text-sm font-medium transition-colors", (activeScreen as string) === "preview" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-amber-500/50 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed")}
            >
              Preview
            </button>
          </div>
        </header>
      )}

      {activeScreen === "worldgen" && !running && (
        <WorldGen 
          outputFolder={outputDir}
          projectName="My_World"
          onDatasetReady={(folderPath, options) => {
            setInputPath(folderPath);
            setIsVideo(false);
            setOutputDir(options.outputDir);
            setOutputFilename(options.outputFilename);
            setUseDifix(options.useDifix);
            setUseBgRemoval(options.useBgRemoval);
            // Don't switch screen, start immediately with the resolved args
            handleStart({
              inputPath: folderPath,
              isVideo: false,
              outputDir: options.outputDir,
              outputFilename: options.outputFilename,
              useDifix: options.useDifix,
              useBgRemoval: options.useBgRemoval
            });
          }} 
          onBack={() => setActiveScreen("home")} 
        />
      )}

      {activeScreen === "home" && !running && (
        <Home 
          onMediaProject={() => setActiveScreen("media_project")}
          onAiProject={() => setActiveScreen("worldgen")}
          onOpenExisting={handleOpenSplat}
          recentProjects={recentProjects}
          onOpenRecent={(path) => {
            setResultSplatPath(path);
            addRecentProject(path); // Update timestamp
            setActiveScreen("preview");
          }}
          outputDir={outputDir}
          onSelectOutputDir={handleSelectOutputDir}
          projectName="My_World"
          onProjectNameChange={() => {}}
          activeCreateTab={activeCreateTab}
          setActiveCreateTab={setActiveCreateTab}
        />
      )}

      {activeScreen === "media_project" && !running && (
        <MediaProject 
          onBack={() => setActiveScreen("home")}
          inputPath={inputPath}
          isVideo={isVideo}
          outputDir={outputDir}
          outputFilename={outputFilename}
          useDifix={useDifix}
          useBgRemoval={useBgRemoval}
          onSelectVideo={handleSelectVideo}
          onSelectImageFolder={handleSelectImageFolder}
          onSelectOutputDir={handleSelectOutputDir}
          onOutputFilenameChange={setOutputFilename}
          onUseDifixChange={setUseDifix}
          onUseBgRemovalChange={setUseBgRemoval}
          onGenerate={() => handleStart()}
          canGenerate={canGenerate}
        />
      )}

      {/* Floating background splat for non-preview screens */}
      {activeScreen !== "preview" && !running && (
        <div className="fixed bottom-0 right-0 w-96 h-96 pointer-events-none opacity-80 z-0">
          <Canvas
            camera={{ position: [0, 0, 3], fov: 40 }}
            gl={{ alpha: true, antialias: true }}
          >
            <FloatingGlitchSplat />
          </Canvas>
        </div>
      )}

      {running && (
        <div className="flex-1 flex flex-col min-h-0 splatforge-processing">
          <div className="splatforge-processing-header px-4 py-2 border-b border-amber-500/20 bg-black/40">
            <p className="text-xs font-mono text-amber-300/90 truncate">
              Input: {basename(inputPath)} · Output: {outputDir}
              {isVideo ? ` · Frames: ${basename(inputPath).replace(/\.[^.]+$/, "")}_images` : ""}
            </p>
            <div className="flex items-center gap-4 mt-1 text-xs text-amber-400/80">
              <span>Elapsed: {elapsedStr}</span>
              <span>Est. ~15–30 min (depends on image count)</span>
            </div>
          </div>
          <div className="flex-1 flex flex-col min-h-0 px-4 py-3 gap-3">
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <div className="flex justify-between text-xs text-amber-300/70">
                {SEGMENT_LABELS.map((label, i) => (
                  <span
                    key={label}
                    className={cn(
                      i <= progressIndex ? "text-amber-400/90" : "text-amber-600/60"
                    )}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="splatforge-segments flex h-2 rounded-full overflow-hidden bg-black/50 border border-amber-500/20">
                {STAGES.map((stage, i) => (
                  <div
                    key={stage}
                    className={cn(
                      "h-full flex-1 border-r last:border-r-0 border-amber-500/20 transition-all duration-300",
                      i < progressIndex && "bg-amber-500/80",
                      i === progressIndex && "splatforge-segment-active",
                      i > progressIndex && "bg-amber-950/40"
                    )}
                  />
                ))}
              </div>
              {progress.message && (
                <p className="text-xs text-amber-400/80">{progress.message}</p>
              )}
            </div>
            <ScrollArea className="splatforge-logs flex-1 min-h-0 rounded-sm border border-amber-500/20 bg-black/60 font-mono text-xs p-3">
              {logs.map((line, i) => (
                <div key={i} className="text-amber-200/80 leading-relaxed">
                  {line}
                </div>
              ))}
              <div ref={logsEndRef} />
            </ScrollArea>
          </div>
          {error && (
            <p className="text-amber-400 text-sm px-4 py-2 bg-amber-950/40 border-t border-amber-500/20">
              {error}
            </p>
          )}
        </div>
      )}

      {activeScreen === "preview" && resultSplatPath && (
        <div className="flex-1 min-h-0 relative">
          <Canvas
            className="w-full h-full"
            camera={{ position: [2, 2, 2], fov: 50 }}
            gl={{ antialias: true, alpha: true }}
          >
            <SparkRendererR3FMinimal />
            <group ref={setSplatTarget} position={splatPos} rotation={splatRot}>
              {/* If we are editing origin, we can render a custom amber axis to signify the pivot */}
              {isEditMode && selectedElement === "splat" && (
                <group>
                  <Line points={[[0, 0, 0], [0.5, 0, 0]]} color="#fbbf24" lineWidth={3} />
                  <Line points={[[0, 0, 0], [0, 0.5, 0]]} color="#fbbf24" lineWidth={3} />
                  <Line points={[[0, 0, 0], [0, 0, 0.5]]} color="#fbbf24" lineWidth={3} />
                </group>
              )}
              <group ref={innerSplatRef}>
                <PersistentSplat
                  ref={persistentSplatRef}
                  src={convertFileSrc(resultSplatPath)}
                  alphaTest={0.1}
                  opacity={1}
                />
              </group>
            </group>
            
            {isEditMode && (
              <>
                <gridHelper args={[20, 20, "#ffffff", "#ffffff"]} />
                <axesHelper args={[10]} />
                
                <GizmoHelper alignment="bottom-left" margin={[80, 80]}>
                  <GizmoViewport 
                    axisColors={['#fbbf24', '#fbbf24', '#fbbf24']} 
                    labelColor="black" 
                    hideNegativeAxes 
                    axisHeadScale={0} 
                    labels={['X', 'Y', 'Z']}
                  />
                </GizmoHelper>
                
                {(activeTool === "move" || activeTool === "rotate") && selectedElement === "splat" && splatTarget && (
                  <TransformControls 
                    object={splatTarget} 
                    mode={activeTool === "rotate" ? "rotate" : "translate"} 
                    onChange={handleTransformChange}
                    onMouseDown={handleDragStart}
                    onMouseUp={handleDragEnd}
                    size={1.5}
                  />
                )}
                
                {/* Crop Box */}
                <group ref={setCropBoxTarget} visible={selectedElement === "cropBox" || activeTool === "crop"}>
                  {/* Invisible mesh for TransformControls to hook onto */}
                  <mesh>
                    <boxGeometry args={[1, 1, 1]} />
                    <meshBasicMaterial visible={false} />
                  </mesh>
                  <CropBoxVisuals />
                </group>
                
                {cropBoxTarget && (selectedElement === "cropBox" || activeTool === "crop") && activeTool !== "select" && (
                  <TransformControls 
                    object={cropBoxTarget} 
                    mode={activeTool === "crop" ? "scale" : activeTool === "rotate" ? "rotate" : "translate"} 
                    size={1.5}
                  />
                )}
              </>
            )}

            <OrbitControls ref={orbitControlsRef} makeDefault enableDamping={false} enableZoom={true} enablePan={true} enabled={activeTool !== "brush"} />
            <KeyboardCameraControls controlsRef={orbitControlsRef} />
          </Canvas>

          {activeTool === "brush" && isEditMode && (
            <div 
              ref={svgOverlayRef}
              className={cn("absolute inset-0 z-20 touch-none cursor-crosshair")}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <svg className="w-full h-full pointer-events-none">
                {strokes.map((stroke, i) => (
                  <polyline key={i} points={stroke.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="rgba(239, 68, 68, 0.6)" strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round" />
                ))}
                {currentStroke && (
                  <polyline points={currentStroke.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="rgba(239, 68, 68, 0.6)" strokeWidth={brushSize} strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </div>
          )}

          {/* Edit Button */}
          {!isEditMode && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
              <Button onClick={() => setIsEditMode(true)} className="bg-amber-500 text-black hover:bg-amber-400 shadow-lg shadow-amber-500/25">
                Edit
              </Button>
            </div>
          )}

          {/* Editor Panels */}
          {isEditMode && (
            <>
              {/* Top/Bottom Center Controls */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex gap-4">
                <Button variant="outline" onClick={() => setIsEditMode(false)} className="border-amber-500/30 text-amber-200 bg-black/60 backdrop-blur hover:bg-amber-500/15">
                  Exit Edit Mode
                </Button>
              </div>

              {/* Left Panel: Tools */}
              <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 p-2 bg-black/60 backdrop-blur-md border border-amber-500/20 rounded-xl z-30">
                <Button 
                  variant={activeTool === "select" ? "secondary" : "ghost"} 
                  size="icon"
                  className={cn("rounded-lg", activeTool === "select" ? "bg-amber-500/30 text-amber-300" : "text-amber-500/50 hover:text-amber-300")}
                  onClick={() => setActiveTool("select")}
                  title="Select"
                >
                  <MousePointer2 className="size-5" />
                </Button>
                <Button 
                  variant={activeTool === "move" ? "secondary" : "ghost"} 
                  size="icon"
                  className={cn("rounded-lg", activeTool === "move" ? "bg-amber-500/30 text-amber-300" : "text-amber-500/50 hover:text-amber-300")}
                  onClick={() => setActiveTool("move")}
                  title="Move"
                >
                  <Move className="size-5" />
                </Button>
                <Button 
                  variant={activeTool === "rotate" ? "secondary" : "ghost"} 
                  size="icon"
                  className={cn("rounded-lg", activeTool === "rotate" ? "bg-amber-500/30 text-amber-300" : "text-amber-500/50 hover:text-amber-300")}
                  onClick={() => setActiveTool("rotate")}
                  title="Rotate"
                >
                  <RotateCw className="size-5" />
                </Button>
                <Button 
                  variant={activeTool === "crop" ? "secondary" : "ghost"} 
                  size="icon"
                  className={cn("rounded-lg", activeTool === "crop" ? "bg-amber-500/30 text-amber-300" : "text-amber-500/50 hover:text-amber-300")}
                  onClick={() => { setActiveTool("crop"); setSelectedElement("cropBox"); }}
                  title="Crop"
                >
                  <Crop className="size-5" />
                </Button>
                <Button 
                  variant={activeTool === "brush" ? "secondary" : "ghost"} 
                  size="icon"
                  className={cn("rounded-lg", activeTool === "brush" ? "bg-amber-500/30 text-amber-300" : "text-amber-500/50 hover:text-amber-300")}
                  onClick={() => { setActiveTool("brush"); setSelectedElement("splat"); }}
                  title="Brush"
                >
                  <Paintbrush className="size-5" />
                </Button>
                
                <div className="h-px bg-amber-500/20 my-1 w-full" />
                
                <Button 
                  variant="ghost" 
                  size="icon"
                  className="rounded-lg text-amber-500/50 hover:text-amber-300"
                  onClick={activeTool === "brush" ? handleApplyBrush : handleApplyCrop}
                  title={activeTool === "brush" ? "Apply Brush Deletion" : "Apply Crop"}
                >
                  <Check className="size-5" />
                </Button>
              </div>

              {/* Right Panel: Objects & Parameters */}
              <div className="absolute right-4 top-20 bottom-20 w-72 flex flex-col gap-4 bg-black/60 backdrop-blur-md border border-amber-500/20 rounded-xl z-30 p-4">
                
                <div className="flex-shrink-0">
                  <h3 className="text-sm font-semibold text-amber-500 mb-2 uppercase tracking-wider">Elements</h3>
                  <div className="flex flex-col gap-1">
                    <button 
                      className={cn("text-left px-3 py-2 text-sm rounded-md transition-colors", selectedElement === "splat" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-amber-100/70 hover:bg-white/5 border border-transparent")}
                      onClick={() => setSelectedElement("splat")}
                    >
                      Gaussian Splat
                    </button>
                    <button 
                      className={cn("text-left px-3 py-2 text-sm rounded-md transition-colors", selectedElement === "cropBox" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-amber-100/70 hover:bg-white/5 border border-transparent")}
                      onClick={() => { setSelectedElement("cropBox"); setActiveTool("crop"); }}
                    >
                      Crop Box
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto border-t border-amber-500/20 pt-4">
                  <h3 className="text-sm font-semibold text-amber-500 mb-3 uppercase tracking-wider">Properties</h3>
                  
                  {selectedElement === "splat" && (
                    <div className="flex flex-col gap-4">
                      <div>
                        <Label className="text-xs text-amber-300/70 mb-1.5 block">Position (Pivot)</Label>
                        <div className="flex gap-2">
                          {["X", "Y", "Z"].map((axis, i) => (
                            <div key={axis} className="flex-1 flex flex-col gap-1">
                              <span className="text-[10px] text-amber-500/50 text-center">{axis}</span>
                              <Input 
                                type="number"
                                step="0.1"
                                className="h-7 px-1 text-xs text-center font-mono bg-black/40 border-amber-500/30 text-amber-200"
                                value={splatPos[i].toFixed(2)}
                                onChange={(e) => updatePos(i, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-amber-300/70 mb-1.5 block">Rotation</Label>
                        <div className="flex gap-2">
                          {["X", "Y", "Z"].map((axis, i) => (
                            <div key={axis} className="flex-1 flex flex-col gap-1">
                              <span className="text-[10px] text-amber-500/50 text-center">{axis}</span>
                              <Input 
                                type="number"
                                step="1"
                                className="h-7 px-1 text-xs text-center font-mono bg-black/40 border-amber-500/30 text-amber-200"
                                value={(splatRot[i] * (180 / Math.PI)).toFixed(1)}
                                onChange={(e) => updateRot(i, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                      <p className="text-[10px] text-amber-200/50 mt-2 leading-relaxed">
                        Tip: Hold <kbd className="bg-amber-900/50 px-1 py-0.5 rounded border border-amber-500/30 font-mono">Shift</kbd> while moving or rotating to edit the origin (pivot) point without moving the splat visually.
                      </p>
                    </div>
                  )}

                  {selectedElement === "cropBox" && (
                    <div className="flex flex-col gap-4">
                      <p className="text-xs text-amber-200/60 leading-relaxed">
                        Use the Crop tool to scale the box, and Move/Rotate to position it. <br/><br/>
                        Particles inside the yellow box will be kept.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-amber-500/30 text-amber-300 hover:bg-amber-500/15"
                        onClick={() => {
                          if (splatTarget && cropBoxTarget) {
                            const box = new THREE.Box3().setFromObject(splatTarget);
                            if (!box.isEmpty()) {
                              const size = new THREE.Vector3();
                              const center = new THREE.Vector3();
                              box.getSize(size);
                              box.getCenter(center);
                              size.multiplyScalar(1.05);
                              size.x = Math.max(size.x, 1);
                              size.y = Math.max(size.y, 1);
                              size.z = Math.max(size.z, 1);
                              cropBoxTarget.position.copy(center);
                              cropBoxTarget.scale.copy(size);
                              cropBoxTarget.rotation.set(0, 0, 0);
                            } else {
                              cropBoxTarget.position.set(0, 0, 0);
                              cropBoxTarget.rotation.set(0, 0, 0);
                              cropBoxTarget.scale.set(5, 5, 5);
                            }
                          }
                        }}
                      >
                        Reset Box
                      </Button>
                    </div>
                  )}

                  {activeTool === "brush" && (
                    <div className="flex flex-col gap-4 mt-4 pt-4 border-t border-amber-500/20">
                      <h3 className="text-sm font-semibold text-amber-500 uppercase tracking-wider">Brush Settings</h3>
                      <div>
                        <Label className="text-xs text-amber-300/70 mb-1.5 block">Brush Size ({brushSize}px)</Label>
                        <input 
                          type="range" 
                          min="5" 
                          max="100" 
                          value={brushSize}
                          onChange={(e) => setBrushSize(parseInt(e.target.value))}
                          className="w-full accent-amber-500"
                        />
                      </div>
                      <p className="text-xs text-amber-200/60 leading-relaxed">
                        Paint over the areas you want to delete.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-amber-500/30 text-amber-300 hover:bg-amber-500/15"
                          onClick={() => setStrokes([])}
                        >
                          Clear Selection
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </>
          )}
        </div>
      )}

      {activeScreen === "preview" && !resultSplatPath && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6 text-amber-500/40">
                <Video className="size-16 opacity-50" />
                <p>Run the pipeline or open a .splat / .ply file to preview here.</p>
              </div>
      )}
    
      {/* Pipeline Error Modal */}
      {pipelineError && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm p-6">
          <Card className="bg-[#0A0A0A] border border-red-500/40 shadow-[0_0_50px_rgba(239,68,68,0.15)] w-full max-w-3xl flex flex-col max-h-full">
            <CardHeader className="border-b border-red-500/20 bg-red-950/20 pb-4 shrink-0">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-500/10 rounded-full">
                    <AlertTriangle className="size-6 text-red-500" />
                  </div>
                  <div>
                    <CardTitle className="text-red-400 text-lg">Pipeline Execution Failed</CardTitle>
                    <p className="text-red-500/60 text-xs mt-1">An error occurred during splat generation.</p>
                  </div>
                </div>
                <button onClick={() => setPipelineError(null)} className="text-red-500/50 hover:text-red-400 p-1">
                  <X className="size-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="p-0 flex flex-col flex-1 min-h-0">
              <div className="p-5 border-b border-red-500/10 shrink-0">
                <p className="text-red-200/90 font-mono text-sm break-words whitespace-pre-wrap">
                  {pipelineError}
                </p>
              </div>
              
              <div className="flex-1 flex flex-col min-h-0 p-5 bg-black/40">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-xs font-semibold text-amber-500/70 uppercase tracking-wider">Execution Logs</h4>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-7 px-3 text-[10px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                      onClick={() => {
                        navigator.clipboard.writeText(logs.join('\n'));
                        alert("Logs copied to clipboard!");
                      }}
                    >
                      <Copy className="size-3 mr-1.5" />
                      Copy Logs
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-7 px-3 text-[10px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                      onClick={async () => {
                        const savePath = await tauriSave({
                          title: "Save Execution Logs",
                          filters: [{ name: "Log File", extensions: ["log", "txt"] }],
                          defaultPath: `splatforge_error_${Date.now()}.log`
                        });
                        if (savePath) {
                          await invoke("save_log_file", { path: savePath, content: logs.join('\n') });
                        }
                      }}
                    >
                      <Download className="size-3 mr-1.5" />
                      Save .log
                    </Button>
                  </div>
                </div>
                
                <ScrollArea className="flex-1 border border-amber-500/10 rounded bg-[#050505] p-3 font-mono text-[10px] text-amber-500/50">
                  {logs.map((line, i) => (
                    <div key={i} className="mb-0.5 break-words">{line}</div>
                  ))}
                  {logs.length === 0 && <div className="italic opacity-50">No logs captured before failure.</div>}
                </ScrollArea>
              </div>
            </CardContent>
            <div className="p-4 border-t border-red-500/20 bg-[#0A0A0A] flex justify-end shrink-0">
              <Button 
                className="bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 hover:text-red-300"
                onClick={() => setPipelineError(null)}
              >
                Dismiss
              </Button>
            </div>
          </Card>
        </div>
      )}
</div>
  );
};

export default App;
