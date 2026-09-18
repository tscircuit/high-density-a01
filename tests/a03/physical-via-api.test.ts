import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"

test("physical A03 expansion is selected at setup and keeps direct defaults", () => {
  const props = {
    viaDiameter: 0.3,
    highResolutionCellSize: 0.2,
    highResolutionCellThickness: 1,
    lowResolutionCellSize: 0.4,
    nodeWithPortPoints: {
      capacityMeshNodeId: "physical-api",
      center: { x: 0, y: 0 },
      width: 1.2,
      height: 1.2,
      availableZ: [0, 1, 2, 3],
      portPoints: [
        { connectionName: "a", x: 0, y: 0, z: 0 },
        { connectionName: "a", x: 0.2, y: 0.2, z: 3 },
      ],
    },
  }
  const direct: any = new HighDensitySolverA03(props)
  expect(direct.viaExpansion).toBe("per-layer")
  expect(direct.getConstructorParams()[0].viaExpansion).toBe("per-layer")
  direct.setup()
  direct.viaExpansion = "physical"
  expect(direct.usePhysicalViaExpansion).toBe(false)
  direct.expandPhysicalVia = () => {
    throw new Error("Direct default must retain per-layer expansion")
  }
  let viaCalls = 0
  const move = direct.computeMoveCostAndRips
  direct.computeMoveCostAndRips = function (...args: any[]) {
    if (args[3]) viaCalls++
    return Reflect.apply(move, this, args)
  }
  while (!direct.solved && !direct.failed) direct.step()
  expect(direct.solved).toBe(true)
  expect(viaCalls).toBeGreaterThan(1)

  const physical: any = new HighDensitySolverA03({
    ...props,
    viaExpansion: "physical",
  })
  physical.setup()
  expect(physical.usePhysicalViaExpansion).toBe(true)
  expect(physical.getConstructorParams()[0].viaExpansion).toBe("physical")
  physical.viaExpansion = "per-layer"
  physical._setup()
  expect(physical.usePhysicalViaExpansion).toBe(false)
  while (!physical.solved && !physical.failed) physical.step()
  expect(physical.getOutput()).toEqual(direct.getOutput())
  expect(physical.iterations).toBe(direct.iterations)
})
