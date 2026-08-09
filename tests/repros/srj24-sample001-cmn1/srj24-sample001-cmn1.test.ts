import { expect, setDefaultTimeout, test } from "bun:test"
import "graphics-debug/matcher"
import type { GraphicsObject } from "graphics-debug"
import { HighDensitySolverA01 } from "../../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { findRouteGeometryViolations } from "../../../lib/routeGeometryValidation"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../../lib/types"
import fixture from "./srj24-sample001-cmn1.json"

setDefaultTimeout(300_000)

const TRACE_COLORS = [
  "rgba(255,0,0,0.8)",
  "rgba(0,0,255,0.8)",
  "rgba(255,165,0,0.8)",
  "rgba(0,128,0,0.8)",
] as const
const PORT_COLORS = ["red", "blue", "orange", "green"] as const

const visualizeRoutesByLayer = (params: {
  node: NodeWithPortPoints
  routes: HighDensityIntraNodeRoute[]
  solverStatus: "solved" | "failed"
  geometryViolationCount: number
}): GraphicsObject => {
  const { node, routes, solverStatus, geometryViolationCount } = params
  const layerGap = 1
  const minX = node.center.x - node.width / 2
  const minY = node.center.y - node.height / 2
  const points: NonNullable<GraphicsObject["points"]> = []
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const circles: NonNullable<GraphicsObject["circles"]> = []
  const rects: NonNullable<GraphicsObject["rects"]> = []
  const texts: NonNullable<GraphicsObject["texts"]> = []

  texts.push({
    x: 0,
    y: 4 * (node.height + layerGap),
    text: `A01 ${solverStatus}: ${routes.length}/46 routes, ${geometryViolationCount} geometry violations`,
    anchorSide: "bottom_left",
    fontSize: 0.42,
    color: "black",
  })

  for (const [layerIndex, z] of (node.availableZ ?? []).entries()) {
    const panelColumn = layerIndex % 2
    const panelRow = Math.floor(layerIndex / 2)
    const offsetX = panelColumn * (node.width + layerGap)
    const offsetY = (3 - panelRow) * (node.height + layerGap)
    const translate = (point: { x: number; y: number }) => ({
      x: point.x - minX + offsetX,
      y: point.y - minY + offsetY,
    })

    rects.push({
      center: {
        x: offsetX + node.width / 2,
        y: offsetY + node.height / 2,
      },
      width: node.width,
      height: node.height,
      stroke: "#777",
    })
    texts.push({
      x: offsetX,
      y: offsetY + node.height,
      text: `PCB layer z${z}`,
      anchorSide: "bottom_left",
      fontSize: 0.28,
      color: "black",
    })

    for (const portPoint of node.portPoints) {
      if (portPoint.z !== z) continue
      points.push({
        ...translate(portPoint),
        color: PORT_COLORS[z] ?? "gray",
      })
    }

    for (const route of routes) {
      for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
        const previous = route.route[pointIndex - 1]!
        const current = route.route[pointIndex]!
        if (previous.z !== z || current.z !== z) continue
        lines.push({
          points: [translate(previous), translate(current)],
          strokeColor: TRACE_COLORS[z] ?? "rgba(128,128,128,0.75)",
          strokeWidth: route.traceThickness,
        })
      }
      for (const via of route.vias) {
        circles.push({
          center: translate(via),
          radius: route.viaDiameter / 2,
          fill: "rgba(0,0,0,0.3)",
          stroke: "black",
        })
      }
    }
  }

  return {
    points,
    lines,
    circles,
    rects,
    texts,
    coordinateSystem: "cartesian",
    title: `A01 layer-by-layer [${routes.length}/46 routes]`,
  }
}

test("visualizes the congested srj24 sample001 region by PCB layer", async () => {
  const solver = new HighDensitySolverA01({
    nodeWithPortPoints: fixture as NodeWithPortPoints,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    viaMinDistFromBorder: 0.15,
    traceMargin: 0.1,
    traceThickness: 0.1,
    effort: 1,
    hyperParameters: { shuffleSeed: 5 },
  })

  solver.solve()

  const output = solver.getOutput()
  const geometryViolationCount = findRouteGeometryViolations(output).length
  expect(solver.solved || solver.failed).toBeTrue()
  expect(solver.iterations).toBeGreaterThan(0)
  await expect(
    visualizeRoutesByLayer({
      node: fixture as NodeWithPortPoints,
      routes: output,
      solverStatus: solver.solved ? "solved" : "failed",
      geometryViolationCount,
    }),
  ).toMatchGraphicsSvg(import.meta.path, {
    svgName: "srj24-sample001-cmn1",
  })
})
