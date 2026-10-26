import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../lib/HighDensitySolverA03/HighDensitySolverA03"
import { applyAffineTransformToPoint } from "../lib/gridToAffineTransform"
import type { StaticRouteSegment } from "../lib/types"

test("A03 keeps physical copper dimensions while scaling its search clearance and border units", () => {
  for (const scale of [1, 2, 4, 8]) {
    const packets: StaticRouteSegment[] = []
    const params = {
      nodeWithPortPoints: {
        capacityMeshNodeId: `physical-scale-${scale}`,
        center: { x: 10, y: 20 },
        width: 2 * scale,
        height: 2 * scale,
        availableZ: [0, 7],
        portPoints: [
          { x: 10 - scale, y: 20, z: 0, connectionName: "wire" },
          { x: 10 + scale, y: 20, z: 7, connectionName: "wire" },
        ],
      },
      viaDiameter: 0.3,
      traceThickness: 0.1,
      traceMargin: 0.1,
      viaMinDistFromBorder: 0.15,
      highResolutionCellSize: 0.1,
    }
    const solver = new HighDensitySolverA03({
      ...params,
      coordinateScale: scale,
      staticSegmentValidator: (packet) => {
        packets.push(packet)
        return true
      },
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    const internal = solver as unknown as {
      traceKeepoutRadius: number
      viaKeepoutRadius: number
      viaAllowed: Uint8Array
    }
    expect(internal.traceKeepoutRadius / scale).toBeCloseTo(0.15, 12)
    expect(internal.viaKeepoutRadius / scale).toBeCloseTo(0.3, 12)
    for (let cell = 0; cell < solver.gridStats.cells; cell++) {
      const point = applyAffineTransformToPoint(solver.gridToBoundsTransform, {
        x: solver.cellCenterX[cell]!,
        y: solver.cellCenterY[cell]!,
      })
      const physicalBorderDistance = Math.min(
        point.x - solver.boundsMinX,
        solver.boundsMaxX - point.x,
        point.y - solver.boundsMinY,
        solver.boundsMaxY - point.y,
      ) / scale
      expect(internal.viaAllowed[cell]).toBe(
        physicalBorderDistance >= params.viaMinDistFromBorder ? 1 : 0,
      )
    }
    expect(packets.length).toBeGreaterThan(0)
    expect(packets.every((packet) => packet.traceThickness === 0.1)).toBe(true)
    expect(packets.every((packet) => packet.viaDiameter === 0.3)).toBe(true)
    const [route] = solver.getOutput()
    expect(route!.traceThickness).toBe(0.1)
    expect(route!.viaDiameter).toBe(0.3)
    expect(route!.route[0]).toEqual(params.nodeWithPortPoints.portPoints[0])
    expect(route!.route.at(-1)).toEqual(params.nodeWithPortPoints.portPoints[1])

    if (scale === 1) {
      const legacy = new HighDensitySolverA03(params)
      legacy.solve()
      const explicitUndefined = new HighDensitySolverA03({
        ...params,
        coordinateScale: undefined,
      })
      explicitUndefined.solve()
      expect(legacy.getOutput()).toEqual(explicitUndefined.getOutput())
      expect(legacy.iterations).toBe(explicitUndefined.iterations)
      expect(legacy.MAX_ITERATIONS).toBe(explicitUndefined.MAX_ITERATIONS)
      expect(legacy.getConstructorParams()[0].coordinateScale).toBeUndefined()
    }
  }
  for (const scale of [0, -1, NaN, Infinity, -Infinity]) {
    expect(() => new HighDensitySolverA03({
      nodeWithPortPoints: {
        capacityMeshNodeId: "invalid-scale",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        portPoints: [],
      },
      viaDiameter: 0.3,
      coordinateScale: scale,
    })).toThrow("A03 coordinateScale must be finite and positive")
  }
})
