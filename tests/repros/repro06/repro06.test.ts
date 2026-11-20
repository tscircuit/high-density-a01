import { expect, test } from "bun:test"
import "bun-match-svg"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { defaultA03Params } from "../../../lib/default-params"
import { HighDensitySolverA03 } from "../../../lib/HighDensitySolverA03/HighDensitySolverA03"
import nodeWithPortPoints from "./repro06.json"

const LAYER_COLORS = ["red", "blue", "orange", "green"]
const minX = nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2
const maxX = nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2
const minY = nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2
const maxY = nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2
const NODE_BOUNDARY = {
  points: [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
    { x: minX, y: minY },
  ],
  strokeColor: "#555",
  strokeWidth: 0.02,
}

const isOnNodeBoundary = (point: { x: number; y: number }) =>
  [
    Math.abs(point.x - minX),
    Math.abs(point.x - maxX),
    Math.abs(point.y - minY),
    Math.abs(point.y - maxY),
  ].some((distance) => distance <= 1e-6)

const borderPortCount =
  nodeWithPortPoints.portPoints.filter(isOnNodeBoundary).length

const inputGraphics = {
  points: nodeWithPortPoints.portPoints.map((point) => ({
    x: point.x,
    y: point.y,
    color: LAYER_COLORS[point.z] ?? "gray",
    label: point.connectionName,
  })),
  lines: [NODE_BOUNDARY],
  coordinateSystem: "cartesian" as const,
}

test("repro06 original A03 output", async () => {
  const solver = new HighDensitySolverA03({
    ...defaultA03Params,
    traceMargin: 0.1,
    nodeWithPortPoints,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  expect(borderPortCount).toBe(8)
  expect(nodeWithPortPoints.portPoints.length - borderPortCount).toBe(10)

  const outputGraphics = solver.visualize()
  const sideBySide = stackGraphicsHorizontally(
    [
      inputGraphics,
      {
        ...outputGraphics,
        lines: [...(outputGraphics.lines ?? []), NODE_BOUNDARY],
      },
    ],
    {
      titles: [
        `Input (${borderPortCount} border, ${nodeWithPortPoints.portPoints.length - borderPortCount} interior)`,
        "A03 output",
      ],
    },
  )
  const svg = getSvgFromGraphicsObject(sideBySide)
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
