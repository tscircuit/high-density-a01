import { expect, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA08Params } from "../../lib/default-params"
import { HighDensitySolverA08 } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"

const dataset02 = dataset02Json as Dataset02Sample[]

function getNodeBounds(nodeWithPortPoints: {
  center: { x: number; y: number }
  width: number
  height: number
}) {
  return {
    minX: nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2,
    maxX: nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2,
    minY: nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2,
    maxY: nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2,
  }
}

test("A08 sample010 uses an exact 1mm inset from populated sides", () => {
  const sample = dataset02[9]
  if (!sample) {
    throw new Error("dataset02 sample010 is missing")
  }

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: "dataset02-10",
      availableZ: [0, 1],
    },
  )

  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints,
    effort: 10,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solve()

  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const innerRect = solver.innerRect

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.innerRectStrategy).toBe("exact-side-inset")
  expect(innerRect).not.toBeNull()

  expect(innerRect!.minX).toBeCloseTo(outerBounds.minX + 1, 6)
  expect(innerRect!.maxX).toBeCloseTo(outerBounds.maxX - 1, 6)
  expect(innerRect!.minY).toBeCloseTo(outerBounds.minY + 1, 6)
  expect(innerRect!.maxY).toBeCloseTo(outerBounds.maxY - 1, 6)

  const topAssignments = solver.spreadAssignments.filter(
    (assignment) => assignment.side === "top",
  )
  expect(topAssignments).toHaveLength(3)

  for (const assignment of topAssignments) {
    expect(
      assignment.original.y - assignment.assigned.y,
    ).toBeGreaterThanOrEqual(0.999)
  }
})
