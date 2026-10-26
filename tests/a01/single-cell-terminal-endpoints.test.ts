import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import type { PortPoint } from "../../lib/types"

test("A01 preserves distinct physical terminals that occupy one grid cell", () => {
  const points = [
    { x: -0.08, y: 0.317329155555555 },
    { x: 0.08, y: 0.237996866666666 },
  ]
  for (const [startPosition, endPosition] of [
    [points[0]!, points[1]!],
    [points[1]!, points[0]!],
    [points[0]!, points[0]!],
  ]) {
    const start: PortPoint = {
      ...startPosition!,
      z: 0,
      connectionName: "fixed",
      rootConnectionName: "net",
      portPointId: "start",
      nextPortPointId: "end",
    }
    const end: PortPoint = {
      ...endPosition!,
      z: 0,
      connectionName: "fixed",
      rootConnectionName: "net",
      portPointId: "end",
      prevPortPointId: "start",
    }
    // The T113 regional problem has one column and nine rows. These
    // physical terminals are 0.179 mm apart but map to the same grid cell.
    const solver = new HighDensitySolverA01({
      nodeWithPortPoints: {
        capacityMeshNodeId: "single-cell-physical-terminals",
        center: { x: 0, y: 0 },
        width: 0.16,
        height: 0.9519874666666667,
        availableZ: [0, 1, 2, 3],
        portPoints: [start, end],
      },
      cellSizeMm: 0.1,
      viaDiameter: 0.45,
      viaMinDistFromBorder: 0.225,
      traceMargin: 0.1,
      traceThickness: 0.1,
      effort: 1,
      hyperParameters: { shuffleSeed: 0 },
    })

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const output = solver.getOutput()
    expect(output).toHaveLength(1)
    const distinct = start.x !== end.x || start.y !== end.y
    expect(output[0]!.route).toEqual(distinct ? [start, end] : [start])
    expect(output[0]!.vias).toEqual([])
  }
})
