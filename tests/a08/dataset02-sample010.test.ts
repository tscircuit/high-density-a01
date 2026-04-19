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

function dot(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x * b.x + a.y * b.y
}

function sub(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: a.x - b.x, y: a.y - b.y }
}

function add(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: a.x + b.x, y: a.y + b.y }
}

function scale(point: { x: number; y: number }, scalar: number) {
  return { x: point.x * scalar, y: point.y * scalar }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function segmentDistance(
  a0: { x: number; y: number },
  a1: { x: number; y: number },
  b0: { x: number; y: number },
  b1: { x: number; y: number },
) {
  const d1 = sub(a1, a0)
  const d2 = sub(b1, b0)
  const r = sub(a0, b0)
  const a = dot(d1, d1)
  const e = dot(d2, d2)
  const f = dot(d2, r)
  let s = 0
  let t = 0

  if (a <= 1e-9 && e <= 1e-9) {
    return Math.hypot(a0.x - b0.x, a0.y - b0.y)
  }

  if (a <= 1e-9) {
    t = clamp(f / Math.max(e, 1e-9), 0, 1)
  } else {
    const c = dot(d1, r)
    if (e <= 1e-9) {
      s = clamp(-c / Math.max(a, 1e-9), 0, 1)
    } else {
      const b = dot(d1, d2)
      const denom = a * e - b * b
      if (Math.abs(denom) > 1e-9) {
        s = clamp((b * f - c * e) / denom, 0, 1)
      }
      const tNom = b * s + f
      if (tNom <= 0) {
        t = 0
        s = clamp(-c / Math.max(a, 1e-9), 0, 1)
      } else if (tNom >= e) {
        t = 1
        s = clamp((b - c) / Math.max(a, 1e-9), 0, 1)
      } else {
        t = tNom / e
      }
    }
  }

  const pointA = add(a0, scale(d1, s))
  const pointB = add(b0, scale(d2, t))
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y)
}

function getMinRoutePairDistance(
  routeA: Array<{ x: number; y: number }>,
  routeB: Array<{ x: number; y: number }>,
) {
  let minDistance = Infinity
  for (
    let segmentIndexA = 0;
    segmentIndexA < routeA.length - 1;
    segmentIndexA++
  ) {
    for (
      let segmentIndexB = 0;
      segmentIndexB < routeB.length - 1;
      segmentIndexB++
    ) {
      minDistance = Math.min(
        minDistance,
        segmentDistance(
          routeA[segmentIndexA]!,
          routeA[segmentIndexA + 1]!,
          routeB[segmentIndexB]!,
          routeB[segmentIndexB + 1]!,
        ),
      )
    }
  }
  return minDistance
}

test("A08 sample010 shrinks the overcrowded bottom breakout before A01", () => {
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
    initialRectMarginMm: 1,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solveUntilStage("A01")

  const outerBounds = getNodeBounds(nodeWithPortPoints)
  const innerRect = solver.innerRect

  expect(solver.stage).toBe("A01")
  expect(solver.failed).toBeFalse()
  expect(innerRect).not.toBeNull()
  expect(solver.breakoutSolver?.stats?.shrinkCount).toBeGreaterThan(0)

  expect(innerRect!.minX).toBeCloseTo(outerBounds.minX + 1, 6)
  expect(innerRect!.maxX).toBeCloseTo(outerBounds.maxX - 1, 6)
  expect(innerRect!.maxY).toBeCloseTo(outerBounds.maxY - 1, 6)
  expect(innerRect!.minY).toBeGreaterThan(outerBounds.minY + 1)

  const topAssignments = solver.spreadAssignments.filter(
    (assignment) => assignment.side === "top",
  )
  expect(topAssignments).toHaveLength(3)
  const topAssignedXs = topAssignments
    .map((assignment) => assignment.assigned.x)
    .sort((a, b) => a - b)

  const topRoutes = solver.breakoutRoutes
    .filter((route) => route.side === "top")
    .map((route) => route.route.map((point) => ({ x: point.x, y: point.y })))
  expect(topRoutes).toHaveLength(3)
  for (const route of topRoutes) {
    expect(route).toHaveLength(3)
  }

  for (const assignment of topAssignments) {
    expect(
      assignment.original.y - assignment.assigned.y,
    ).toBeGreaterThanOrEqual(0.999)
  }
  expect(topAssignedXs[0]! - innerRect!.minX).toBeGreaterThan(1)
  expect(innerRect!.maxX - topAssignedXs[2]!).toBeGreaterThan(1)
  expect(topAssignedXs[1]! - topAssignedXs[0]!).toBeGreaterThan(2)
  expect(topAssignedXs[2]! - topAssignedXs[1]!).toBeGreaterThan(2)

  expect(
    getMinRoutePairDistance(topRoutes[0]!, topRoutes[1]!),
  ).toBeGreaterThanOrEqual(0.1)
  expect(
    getMinRoutePairDistance(topRoutes[1]!, topRoutes[2]!),
  ).toBeGreaterThanOrEqual(0.1)

  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.getOutput().length).toBeGreaterThan(0)
})
