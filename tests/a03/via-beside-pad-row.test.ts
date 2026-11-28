import { expect, test } from "bun:test"
import "graphics-debug/matcher"
import type { GraphicsObject } from "graphics-debug"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import type { StaticRouteSegment } from "../../lib/types"

const pointToSegmentDistance = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) /
              lengthSquared,
          ),
        )
  return Math.hypot(
    point.x - start.x - projection * dx,
    point.y - start.y - projection * dy,
  )
}

test("A03 fits a legal via beside a trace between package pads", (): void => {
  const pads = [
    { x: -0.325, y: -0.325 },
    { x: 0.325, y: -0.325 },
    { x: -0.325, y: 0.325 },
    { x: 0.325, y: 0.325 },
  ]
  const validate = (segment: StaticRouteSegment): boolean => {
    if (segment.connectionName === "row") return true
    const via = segment.start.z !== segment.end.z
    if (!via && segment.start.z !== 0) return true
    const radius = via ? 0.175 : 0.04
    return pads.every(
      (pad) =>
        pointToSegmentDistance(pad, segment.start, segment.end) >=
        0.175 + radius + 0.1 - 1e-9,
    )
  }
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: {
      capacityMeshNodeId: "pad-row",
      center: { x: 0, y: 0.1625 },
      width: 0.65,
      height: 0.325,
      availableZ: [0, 1],
      portPoints: [
        { x: -0.325, y: 0.325, z: 0, connectionName: "row" },
        { x: 0.325, y: 0.325, z: 0, connectionName: "row" },
        { x: 0, y: 0, z: 0, connectionName: "via" },
        { x: 0, y: 0, z: 1, connectionName: "via" },
      ],
    },
    highResolutionCellSize: 0.005,
    lowResolutionCellSize: 0.005,
    viaDiameter: 0.35,
    traceThickness: 0.08,
    traceMargin: 0.14,
    viaMinDistFromBorder: 0,
    staticSegmentValidator: validate,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  const row = routes.find((route) => route.connectionName === "row")!
  const crossing = routes.find((route) => route.connectionName === "via")!
  expect(crossing.vias).toHaveLength(1)
  const via = crossing.vias[0]!
  const gap =
    Math.min(
      ...row.route
        .slice(1)
        .map((end, index) =>
          pointToSegmentDistance(via, row.route[index]!, end),
        ),
    ) -
    0.175 -
    0.04
  expect(gap).toBeGreaterThanOrEqual(0.1 - 1e-9)
  const graphics: GraphicsObject = solver.visualize()
  graphics.circles = [
    ...(graphics.circles ?? []),
    ...pads.map((center) => ({
      center,
      radius: 0.175,
      fill: "rgba(120,120,120,0.25)",
      stroke: "gray",
    })),
  ]
  graphics.texts = [
    {
      x: -0.5,
      y: 0.6,
      fontSize: 0.055,
      text: `Trace–via copper gap: ${gap.toFixed(3)} mm; minimum 0.100 mm`,
    },
  ]
  expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
