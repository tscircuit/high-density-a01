import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("A03 preserves endpoint identities and copper dimensions on a large grid", (): void => {
  const ports = [
    { x: -20, y: 200, z: 0, connectionName: "DDR_DQ0", portPointId: "cpu" },
    { x: 220, y: 200, z: 1, connectionName: "DDR_DQ0", portPointId: "ram" },
  ]
  const solver = new HighDensitySolverA03({
    nodeWithPortPoints: {
      capacityMeshNodeId: "translated-resized-node",
      center: { x: 100, y: 200 },
      width: 256,
      height: 128,
      availableZ: [0, 1],
      portPoints: ports,
    },
    maxIterations: 100_000,
    traceThickness: 0.127,
    viaDiameter: 0.6,
    traceMargin: 0.1,
    effort: 1,
    hyperParameters: { shuffleSeed: 0 },
  })
  expect(solver.visualize().points).toHaveLength(2)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  const [route] = solver.getOutput()
  expect(route!.route[0]).toEqual(ports[0]!)
  expect(route!.route.at(-1)).toEqual(ports[1]!)
  expect(route!.traceThickness).toBe(0.127)
  expect(route!.viaDiameter).toBe(0.6)
  expect(route!.vias.length).toBeGreaterThan(0)
  for (const via of route!.vias) {
    expect(via.x).toBeGreaterThan(-28)
    expect(via.x).toBeLessThan(228)
    expect(via.y).toBeGreaterThan(136)
    expect(via.y).toBeLessThan(264)
  }
  expect(solver.visualize().circles![0]!.radius).toBe(0.3)
  expect(solver.gridStats.states).toBeLessThan(2560 * 1280)
})
