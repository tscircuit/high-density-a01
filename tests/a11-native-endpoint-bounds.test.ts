import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "../lib/HighDensitySolverA11/HighDensitySolverA11"
import type { NodeWithPortPoints } from "../lib/types"

test("A11 rejects unreachable exact endpoints before searching and preserves boundary endpoints", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "native-domain",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "net", x: -1, y: 0, z: 0 },
      { connectionName: "net", x: 1, y: 0, z: 0 },
    ],
  }
  const inside = new HighDensitySolverA11({
    nodeWithPortPoints: node,
    viaDiameter: 0.3,
  })
  inside.solve()
  expect(inside.solved).toBeTrue()
  expect(inside.getOutput()[0]!.route[0]).toMatchObject(node.portPoints[0]!)
  expect(inside.getOutput()[0]!.route.at(-1)).toMatchObject(node.portPoints[1]!)
  for (const position of [
    { x: -1.01, y: 0 },
    { x: 1.01, y: 0 },
    { x: 0, y: -1.01 },
    { x: 0, y: 1.01 },
    { x: Infinity, y: 0 },
  ]) {
    const outsideNode = structuredClone(node)
    Object.assign(outsideNode.portPoints[0]!, position)
    const solver = new HighDensitySolverA11({
      nodeWithPortPoints: outsideNode,
      viaDiameter: 0.3,
    })
    solver.solve()
    expect(solver.failed).toBeTrue()
    expect(solver.solved).toBeFalse()
    expect(solver.iterations).toBeLessThanOrEqual(1)
    expect(solver.error).toContain("outside native bounds or non-finite")
  }
})
