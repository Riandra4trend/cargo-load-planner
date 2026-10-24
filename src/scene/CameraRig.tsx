import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Box3, MathUtils, Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Vector3, type Camera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useStore } from '../state/store';
import { interaction, syncControls } from './interaction';

export type SceneView = '3d' | 'side' | 'top';

/** Camera framing: orbit target, view orientation and the visible half-height at the target (world metres). */
interface Pose {
  target: Vector3;
  quat: Quaternion;
  halfH: number;
}

const FOV = 38;
const TAN_HALF_FOV = Math.tan(MathUtils.degToRad(FOV / 2));
/** Orthographic cameras sit this far from their target; zoom sets the framing. */
const ORTHO_DISTANCE = 120;
const TRANSITION_MS = 600;

const VIEW_DIRECTION: Record<SceneView, Vector3> = {
  '3d': new Vector3(0.34, 0.5, 1).normalize(),
  side: new Vector3(0, 0, 1),
  top: new Vector3(0, 1, 0),
};
const VIEW_UP: Record<SceneView, Vector3> = {
  '3d': new Vector3(0, 1, 0),
  side: new Vector3(0, 1, 0),
  top: new Vector3(0, 0, -1),
};

function viewQuaternion(view: SceneView): Quaternion {
  const m = new Matrix4().lookAt(VIEW_DIRECTION[view], new Vector3(), VIEW_UP[view]);
  return new Quaternion().setFromRotationMatrix(m);
}

/** Pose that frames `box` (world space) for a view at the given aspect ratio. */
function fitPose(view: SceneView, box: Box3, aspect: number): Pose {
  const quat = viewQuaternion(view);
  const right = new Vector3(1, 0, 0).applyQuaternion(quat);
  const up = new Vector3(0, 1, 0).applyQuaternion(quat);
  const forward = new Vector3(0, 0, 1).applyQuaternion(quat);
  const a = Math.max(0.2, aspect);
  const margin = 1.06;
  const corners: Vector3[] = [];
  for (let i = 0; i < 8; i++) corners.push(new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const centre = box.getCenter(new Vector3());
  const c = new Vector3();
  if (view !== '3d') {
    let maxR = 0;
    let maxU = 0;
    for (const p of corners) {
      c.subVectors(p, centre);
      maxR = Math.max(maxR, Math.abs(c.dot(right)));
      maxU = Math.max(maxU, Math.abs(c.dot(up)));
    }
    return { target: centre, quat, halfH: Math.max(maxU, maxR / a) * margin + 0.2 };
  }
  // Perspective: camera distance D must satisfy |u| <= (D - d)·tan and |r| <= (D - d)·tan·aspect for every
  // corner (d = depth toward the camera). Two passes: fit, re-centre the projected bounds, fit again.
  let distance = 0;
  for (let pass = 0; pass < 2; pass++) {
    distance = 0;
    for (const p of corners) {
      c.subVectors(p, centre);
      distance = Math.max(distance, c.dot(forward) + Math.max(Math.abs(c.dot(up)), Math.abs(c.dot(right)) / a) / TAN_HALF_FOV);
    }
    if (pass === 1) break;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of corners) {
      c.subVectors(p, centre);
      const depth = distance - c.dot(forward);
      const sx = c.dot(right) / depth;
      const sy = c.dot(up) / depth;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    centre.addScaledVector(right, ((minX + maxX) / 2) * distance).addScaledVector(up, ((minY + maxY) / 2) * distance);
  }
  return { target: centre, quat, halfH: distance * TAN_HALF_FOV * margin };
}

function isPerspective(cam: Camera): cam is PerspectiveCamera {
  return (cam as PerspectiveCamera).isPerspectiveCamera === true;
}

function poseOf(cam: Camera, target: Vector3, height: number): Pose {
  const halfH = isPerspective(cam) ? cam.position.distanceTo(target) * TAN_HALF_FOV : height / 2 / (cam as OrthographicCamera).zoom;
  return { target: target.clone(), quat: cam.quaternion.clone(), halfH };
}

const tmpOffset = new Vector3();
const framePose: Pose = { target: new Vector3(), quat: new Quaternion(), halfH: 1 };

function applyPose(cam: Camera, pose: Pose, height: number, target: Vector3): void {
  let distance = ORTHO_DISTANCE;
  if (isPerspective(cam)) distance = pose.halfH / TAN_HALF_FOV;
  else {
    const ortho = cam as OrthographicCamera;
    ortho.zoom = height / 2 / pose.halfH;
    ortho.updateProjectionMatrix();
  }
  tmpOffset.set(0, 0, 1).applyQuaternion(pose.quat).multiplyScalar(distance);
  cam.position.copy(pose.target).add(tmpOffset);
  cam.quaternion.copy(pose.quat);
  cam.updateMatrixWorld();
  target.copy(pose.target);
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export interface CameraRigProps {
  view: SceneView;
  /** Region to frame when fitting (world space). */
  fitBox: Box3;
  /** Changes when the framing should be redone (vehicle switch, animation start). */
  fitKey: string;
  /** World-space bounds of a unit for focus requests, or null when it is not shown. */
  locateUnit: (unitId: string) => Box3 | null;
}

/**
 * Cameras for the three views (perspective 3D, orthographic side from the left, orthographic top),
 * orbit controls with damping, smooth animated transitions, fit-to-vehicle and focus requests.
 */
export function CameraRig({ view, fitBox, fitKey, locateUnit }: CameraRigProps) {
  const set = useThree((s) => s.set);
  const size = useThree((s) => s.size);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const target = useRef(new Vector3());
  const tween = useRef<{ from: Pose; to: Pose; start: number } | null>(null);
  const prevView = useRef<SceneView | null>(null);
  const prevFitKey = useRef<string | null>(null);
  const focusNonce = useStore((s) => s.ui.focus.nonce);
  const prevNonce = useRef(focusNonce);
  /** Focus request waiting for its unit to appear (e.g. while the active vehicle switches). */
  const pendingFocus = useRef<string | null>(null);

  const cameras = useMemo(() => {
    const persp = new PerspectiveCamera(FOV, 1, 0.1, 800);
    const side = new OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
    const top = new OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
    top.up.copy(VIEW_UP.top);
    const all = { '3d': persp, side, top } satisfies Record<SceneView, Camera>;
    for (const cam of Object.values(all)) Object.assign(cam, { manual: true });
    return all;
  }, []);
  const camera = cameras[view];
  /** True while the framing is automatic (no user orbit/pan/zoom since the last fit): resizes refit. */
  const autoFramed = useRef(true);
  const latest = useRef({ view, fitBox, camera });
  latest.current = { view, fitBox, camera };

  /** Applies a pose immediately (no animation) and points the orbit controls at its target. */
  const place = (cam: Camera, pose: Pose, height: number) => {
    applyPose(cam, pose, height, target.current);
    controlsRef.current?.target.copy(pose.target);
    controlsRef.current?.update();
  };

  // Projection follows the canvas size (cameras are manual, R3F leaves them alone).
  useLayoutEffect(() => {
    cameras['3d'].aspect = size.width / Math.max(1, size.height);
    cameras['3d'].updateProjectionMatrix();
    for (const ortho of [cameras.side, cameras.top]) {
      ortho.left = -size.width / 2;
      ortho.right = size.width / 2;
      ortho.top = size.height / 2;
      ortho.bottom = -size.height / 2;
      ortho.updateProjectionMatrix();
    }
    // Keep an automatic framing fitted when the canvas is resized (layout changes, panels).
    const { view: v, fitBox: box, camera: cam } = latest.current;
    if (autoFramed.current && prevView.current !== null) {
      const to = fitPose(v, box, size.width / Math.max(1, size.height));
      if (tween.current) tween.current.to = to;
      else place(cam, to, size.height);
    }
  }, [cameras, size.width, size.height]);

  const startTween = (to: Pose, from: Pose) => {
    tween.current = { from, to, start: performance.now() };
    interaction.tweening = true;
    syncControls();
  };

  // Active camera, view transitions and fitting.
  useLayoutEffect(() => {
    set({ camera });
    const aspect = size.width / Math.max(1, size.height);
    const to = fitPose(view, fitBox, aspect);
    if (prevView.current === null) {
      place(camera, to, size.height);
    } else if (prevView.current !== view || prevFitKey.current !== fitKey) {
      const fromCam = cameras[prevView.current];
      startTween(to, poseOf(fromCam, target.current, size.height));
    }
    prevView.current = view;
    autoFramed.current = true;
    prevFitKey.current = fitKey;
    // `fitBox` and the canvas size are read fresh whenever the view or the fit key changes.
  }, [camera, view, fitKey]);

  // Focus requests: animate to a unit (keeping the viewing direction) or fit the vehicle.
  useLayoutEffect(() => {
    const isNew = prevNonce.current !== focusNonce;
    if (isNew) {
      prevNonce.current = focusNonce;
      pendingFocus.current = null;
    }
    const unitId = isNew ? useStore.getState().ui.focus.unitId : pendingFocus.current;
    if (!isNew && !unitId) return;
    const from = poseOf(camera, target.current, size.height);
    const box = unitId ? locateUnit(unitId) : null;
    if (box) {
      pendingFocus.current = null;
      const dims = box.getSize(new Vector3());
      autoFramed.current = false;
      startTween({ target: box.getCenter(new Vector3()), quat: camera.quaternion.clone(), halfH: Math.max(2.6, dims.length() * 1.6) }, from);
      return;
    }
    const { plan, ui } = useStore.getState();
    const placement = unitId ? plan.placements[unitId] : undefined;
    if (unitId && placement && placement.vehicleId !== ui.activeVehicleId) {
      // The viewport switches to the unit's vehicle; focus once it is shown.
      pendingFocus.current = unitId;
      return;
    }
    pendingFocus.current = null;
    if (!isNew) return;
    autoFramed.current = true;
    startTween(fitPose(view, fitBox, size.width / Math.max(1, size.height)), from);
  }, [focusNonce, camera, view, fitBox, locateUnit, size.width, size.height]);

  // Keep the shared interaction state pointing at the live controls instance.
  useLayoutEffect(() => {
    interaction.controls = controlsRef.current;
    syncControls();
  });

  useFrame((state) => {
    const tw = tween.current;
    const controls = controlsRef.current;
    if (!tw) {
      if (controls) target.current.copy(controls.target);
      return;
    }
    const p = Math.min(1, (performance.now() - tw.start) / TRANSITION_MS);
    const e = easeInOut(p);
    framePose.target.lerpVectors(tw.from.target, tw.to.target, e);
    framePose.quat.slerpQuaternions(tw.from.quat, tw.to.quat, e);
    framePose.halfH = Math.exp(MathUtils.lerp(Math.log(tw.from.halfH), Math.log(tw.to.halfH), e));
    applyPose(camera, framePose, state.size.height, target.current);
    if (controls) controls.target.copy(target.current);
    if (p >= 1) {
      tween.current = null;
      interaction.tweening = false;
      syncControls();
      controls?.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      camera={camera}
      enableDamping
      dampingFactor={0.12}
      enableRotate={view === '3d'}
      maxPolarAngle={view === '3d' ? Math.PI * 0.495 : Math.PI}
      minDistance={1.2}
      maxDistance={160}
      minZoom={2}
      maxZoom={900}
      screenSpacePanning
      onStart={() => {
        autoFramed.current = false;
      }}
    />
  );
}
