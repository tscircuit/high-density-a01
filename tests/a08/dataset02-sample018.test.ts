import { expect, test } from "bun:test"
import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultA08Params } from "../../lib/default-params"
import { HighDensitySolverA08 } from "../../lib/HighDensitySolverA08/HighDensitySolverA08"

const dataset02 = dataset02Json as Dataset02Sample[]

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

function getMidpointOffset(route: Array<{ x: number; y: number }>) {
  const start = route[0]!
  const midpoint = route[1]!
  const end = route[2]!
  return {
    dx: midpoint.x - (start.x + end.x) / 2,
    dy: midpoint.y - (start.y + end.y) / 2,
  }
}

function toStraightRoute(route: Array<{ x: number; y: number; z: number }>) {
  const start = route[0]!
  const end = route[2]!
  return [
    start,
    {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      z: start.z,
    },
    end,
  ]
}

test("A08 sample018 force-improves the tight left-side A/F breakouts", () => {
  const sample = dataset02[17]
  if (!sample) {
    throw new Error("dataset02 sample018 is missing")
  }

  const nodeWithPortPoints = convertDataset02SampleToNodeWithPortPoints(
    sample,
    {
      capacityMeshNodeId: "dataset02-18",
      availableZ: [0, 1],
    },
  )

  const solver = new HighDensitySolverA08({
    ...defaultA08Params,
    nodeWithPortPoints,
    effort: 10,
  })
  solver.MAX_ITERATIONS = 100_000_000
  solver.solveUntilStage("A01")

  expect(solver.stage).toBe("A01")
  expect(solver.failed).toBeFalse()
  expect(solver.breakoutSolver?.iterations).toBeGreaterThan(0)

  const leftRoutes = solver.breakoutRoutes.filter(
    (route) => route.side === "left",
  )
  const leftARoute = leftRoutes.find(
    (route) => route.connectionName === "A" && route.original.y > -10,
  )
  const leftFRoute = leftRoutes.find((route) => route.connectionName === "F")

  expect(leftARoute).toBeDefined()
  expect(leftFRoute).toBeDefined()

  const aOffset = getMidpointOffset(
    leftARoute!.route.map((point) => ({ x: point.x, y: point.y })),
  )
  const fOffset = getMidpointOffset(
    leftFRoute!.route.map((point) => ({ x: point.x, y: point.y })),
  )

  expect(Math.hypot(aOffset.dx, aOffset.dy)).toBeGreaterThan(0.03)
  expect(Math.hypot(fOffset.dx, fOffset.dy)).toBeGreaterThan(0.02)

  const initialDistance = getMinRoutePairDistance(
    toStraightRoute(leftARoute!.route).map((point) => ({
      x: point.x,
      y: point.y,
    })),
    toStraightRoute(leftFRoute!.route).map((point) => ({
      x: point.x,
      y: point.y,
    })),
  )
  const finalDistance = getMinRoutePairDistance(
    leftARoute!.route.map((point) => ({ x: point.x, y: point.y })),
    leftFRoute!.route.map((point) => ({ x: point.x, y: point.y })),
  )

  expect(finalDistance).toBeGreaterThan(initialDistance + 0.01)
})
