import { memo, useMemo } from "react";
import { LineBasicMaterial, MeshStandardMaterial } from "three";
import type { Customer, Stop, Vehicle } from "../domain/types";
import { MATERIALS } from "./materials";
import { boxEdgePoints, CBox, CCyl, CLines, FloorRect } from "./prims";
import { LABEL_SPACE, type DockLayout, type StagingLane } from "./staging";
import { labelMaterial } from "./VehicleModel";

const laneFill = new Map<string, MeshStandardMaterial>();
const laneLine = new Map<string, LineBasicMaterial>();

function laneMaterials(color: string): {
  fill: MeshStandardMaterial;
  line: LineBasicMaterial;
} {
  let fill = laneFill.get(color);
  if (!fill) {
    fill = new MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      roughness: 0.95,
    });
    laneFill.set(color, fill);
  }
  let line = laneLine.get(color);
  if (!line) {
    line = new LineBasicMaterial({ color });
    laneLine.set(color, line);
  }
  return { fill, line };
}

/**
 * Loading dock behind the rear doors: site ground, raised dock slab at deck height, warehouse wall
 * with dock door, seal, bumpers and leveller, and one colour-coded staging lane per stop.
 */
export const DockScene = memo(function DockScene({
  vehicle,
  dock,
  stops,
  customers,
  groundOnly = false,
}: {
  vehicle: Vehicle;
  dock: DockLayout;
  stops: Stop[];
  customers: Customer[];
  groundOnly?: boolean;
}) {
  const { l, w, h } = vehicle.cargo;
  const ground = -vehicle.deckHeight;
  const { wallX, floor } = dock;
  const wallH = Math.max(5, h + 2);
  const doorHalf = Math.max(vehicle.door.w, w) / 2 + 0.25;
  const doorMinY = w / 2 - doorHalf;
  const doorMaxY = w / 2 + doorHalf;
  const doorTop = Math.min(wallH - 0.6, h + 0.35);
  const wallEdges = useMemo(
    () =>
      boxEdgePoints([wallX, floor.minY, 0], [wallX + 0.2, floor.maxY, wallH]),
    [wallX, floor.minY, floor.maxY, wallH],
  );
  return (
    <group>
      {/* site ground */}
      <FloorRect
        minX={-60}
        maxX={floor.maxX + 30}
        minY={-40}
        maxY={w + 40}
        z={ground - 0.002}
        material={MATERIALS.ground}
      />
      {!groundOnly && (
        <>
          {/* dock slab at deck height, its face and bumpers */}
          <CBox
            min={[wallX, floor.minY, ground]}
            max={[floor.maxX, floor.maxY, 0]}
            material={MATERIALS.dockSlab}
          />
          <CBox
            min={[wallX - 0.02, floor.minY, ground]}
            max={[wallX, floor.maxY, 0]}
            material={MATERIALS.dockFace}
          />
          {[doorMinY + 0.15, doorMaxY - 0.4].map((y) => (
            <CBox
              key={y}
              min={[wallX - 0.14, y, -0.5]}
              max={[wallX - 0.02, y + 0.25, -0.12]}
              material={MATERIALS.bumper}
            />
          ))}
          {/* leveller bridging the gap onto the cargo floor, with hazard edges */}
          <CBox
            min={[l - 0.04, 0.15, -0.025]}
            max={[wallX + 0.6, w - 0.15, 0.004]}
            material={MATERIALS.leveller}
          />
          <CBox
            min={[l - 0.04, 0.15, 0.004]}
            max={[wallX + 0.6, 0.25, 0.008]}
            material={MATERIALS.hazardYellow}
          />
          <CBox
            min={[l - 0.04, w - 0.25, 0.004]}
            max={[wallX + 0.6, w - 0.15, 0.008]}
            material={MATERIALS.hazardYellow}
          />
          {/* warehouse wall with the dock door opening */}
          <CBox
            min={[wallX, floor.minY, 0]}
            max={[wallX + 0.2, doorMinY, wallH]}
            material={MATERIALS.warehouseWall}
          />
          <CBox
            min={[wallX, doorMaxY, 0]}
            max={[wallX + 0.2, floor.maxY, wallH]}
            material={MATERIALS.warehouseWall}
          />
          <CBox
            min={[wallX, doorMinY, doorTop]}
            max={[wallX + 0.2, doorMaxY, wallH]}
            material={MATERIALS.warehouseWall}
          />
          <CLines points={wallEdges} />
          {/* door frame, rolled-up shutter and seal pads */}
          <CBox
            min={[wallX - 0.02, doorMinY - 0.12, 0]}
            max={[wallX + 0.24, doorMinY, doorTop]}
            material={MATERIALS.doorFrame}
          />
          <CBox
            min={[wallX - 0.02, doorMaxY, 0]}
            max={[wallX + 0.24, doorMaxY + 0.12, doorTop]}
            material={MATERIALS.doorFrame}
          />
          <CBox
            min={[wallX - 0.02, doorMinY - 0.12, doorTop]}
            max={[wallX + 0.24, doorMaxY + 0.12, doorTop + 0.12]}
            material={MATERIALS.doorFrame}
          />
          <CCyl
            centre={[wallX + 0.45, w / 2, doorTop + 0.3]}
            radius={0.24}
            length={doorMaxY - doorMinY}
            axis={1}
            material={MATERIALS.shutter}
          />
          <CBox
            min={[wallX - 0.3, doorMinY - 0.4, 0.1]}
            max={[wallX - 0.02, doorMinY - 0.12, doorTop]}
            material={MATERIALS.seal}
          />
          <CBox
            min={[wallX - 0.3, doorMaxY + 0.12, 0.1]}
            max={[wallX - 0.02, doorMaxY + 0.4, doorTop]}
            material={MATERIALS.seal}
          />
          <CBox
            min={[wallX - 0.3, doorMinY - 0.4, doorTop + 0.02]}
            max={[wallX - 0.02, doorMaxY + 0.4, doorTop + 0.36]}
            material={MATERIALS.seal}
          />
          {dock.lanes.map((lane) => {
            const stop = stops.find((s) => s.id === lane.stopId);
            const customer = customers.find((c) => c.id === stop?.customerId);
            return (
              <LaneView
                key={lane.stopId}
                lane={lane}
                color={customer?.color ?? "#9a968c"}
                text={`${lane.stopSeq} · ${customer?.name ?? stop?.name ?? "Stop"}`}
              />
            );
          })}
        </>
      )}
    </group>
  );
});

/** One staging lane: tinted floor, painted border and the stop label at the lane head. */
const LaneView = memo(function LaneView({
  lane,
  color,
  text,
}: {
  lane: StagingLane;
  color: string;
  text: string;
}) {
  const mats = laneMaterials(color);
  const { minX, maxX, minY, maxY } = lane;
  const border = useMemo(
    () => [
      minX,
      minY,
      0.008,
      maxX,
      minY,
      0.008,
      maxX,
      minY,
      0.008,
      maxX,
      maxY,
      0.008,
      maxX,
      maxY,
      0.008,
      minX,
      maxY,
      0.008,
      minX,
      maxY,
      0.008,
      minX,
      minY,
      0.008,
    ],
    [minX, maxX, minY, maxY],
  );
  const labelLength = LABEL_SPACE - 0.3;
  const labelWidth = Math.min(maxY - minY - 0.2, labelLength / 3.2);
  const cy = (minY + maxY) / 2;
  return (
    <group>
      <FloorRect
        minX={minX}
        maxX={maxX}
        minY={minY}
        maxY={maxY}
        z={0.004}
        material={mats.fill}
      />
      <CLines points={border} material={mats.line} />
      <FloorRect
        minX={minX + 0.12}
        maxX={minX + 0.12 + labelLength}
        minY={cy - labelWidth / 2}
        maxY={cy + labelWidth / 2}
        z={0.01}
        material={labelMaterial(
          text,
          "#2d2b27",
          Math.round((labelLength / labelWidth) * 10) / 10,
        )}
      />
    </group>
  );
});
