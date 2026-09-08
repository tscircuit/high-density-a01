import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 preserves via border clearance in emitted board coordinates", () => {
  for (const [centerX, centerY, rotate] of [
    [0, 0, false],
    [5, -4, false],
    [-2, 7, true],
  ] as const) {
    const width = rotate ? 1.1 : 2.3
    const height = rotate ? 2.3 : 1.1
    const place = (x: number, y: number, z: number) => ({
      x: centerX + (rotate ? y : x),
      y: centerY + (rotate ? x : y),
      z,
      connectionName: "signal",
    })
    const solver = new HighDensitySolverA03({
      nodeWithPortPoints: {
        capacityMeshNodeId: "node",
        center: { x: centerX, y: centerY },
        width,
        height,
        portPoints: [place(-1.15, -0.4, 0), place(1.15, -0.4, 1)],
      },
      highResolutionCellSize: 0.1,
      highResolutionCellThickness: 8,
      lowResolutionCellSize: 0.4,
      viaDiameter: 0.3,
      viaMinDistFromBorder: 0.15,
      traceThickness: 0.1,
      traceMargin: 0.1,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const output = solver.getOutput()
    expect(output).toHaveLength(1)
    expect(output[0]!.vias).toHaveLength(1)
    const via = output[0]!.vias[0]!
    expect(
      Math.min(
        via.x - (centerX - width / 2),
        centerX + width / 2 - via.x,
        via.y - (centerY - height / 2),
        centerY + height / 2 - via.y,
      ),
    ).toBeGreaterThanOrEqual(0.15 - 1e-9)
    expect(output[0]!.viaDiameter).toBe(0.3)
  }
})
