import { mkdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import {
  createGraphicsGrid,
  getSvgFromGraphicsObject,
  type GraphicsObject,
} from "graphics-debug"
import { defaultA05Params } from "../lib/default-params"
import { applyAffineTransformToPoint } from "../lib/gridToAffineTransform"
import { HighDensitySolverA05 } from "../lib/HighDensitySolverA05/HighDensitySolverA05"
import type { NodeWithPortPoints } from "../lib/types"

type FailedHighDensityNodeEntry = {
  capacityMeshNodeId: string
  solverType?: string
  iterations?: number
  routeCount?: number
  nodePf?: number
  error?: string
  nodeWithPortPoints: NodeWithPortPoints
}

type FailedHighDensityNodeCollection = {
  generatedAt?: string
  source?: string
  effort?: number
  error?: string
  failedHighDensityNodes: FailedHighDensityNodeEntry[]
}

type CheckpointReport = {
  label: string
  requestedIteration: number | "final"
  iterations: number
  solved: boolean
  failed: boolean
  error: string | null
  routes: number
  totalRipEvents: number | null
  unsolvedSegments: number | null
  activeConnection: string | null
  congestion: {
    activeCellCount: number
    maxDeltaPenalty: number
    weightedCentroid: { x: number; y: number } | null
  }
}

type A05DiagnosticView = {
  penalty2d?: Float64Array
  planeSize?: number
  gridToBoundsTransform?: {
    a: number
    b: number
    c: number
    d: number
    e: number
    f: number
  }
  cellCenterX?: Float64Array
  cellCenterY?: Float64Array
  cellWidth?: Float64Array
  cellHeight?: Float64Array
  totalRipEvents?: number
  unsolvedSegs?: Array<unknown>
  activeConnId?: number
  connIdToName?: string[]
}

const args = process.argv.slice(2)
const fixtureArg = args.find((arg) => arg.startsWith("--fixture="))
const nodeIdArg = args.find((arg) => arg.startsWith("--node-id="))
const indexArg = args.find((arg) => arg.startsWith("--index="))
const checkpointsArg = args.find((arg) => arg.startsWith("--checkpoints="))
const outDirArg = args.find((arg) => arg.startsWith("--out-dir="))

const fixturePath = resolve(
  fixtureArg?.split("=")[1] ??
    "fixtures/bugreport46-ac4337-arduino-uno/bugreport46-ac4337-arduino-uno.json",
)

const requestedCheckpoints = (() => {
  const raw =
    checkpointsArg?.split("=")[1] ?? "0,1000,10000,100000,500000,1000000"
  return [
    ...new Set(
      raw
        .split(",")
        .map((token) => Number.parseInt(token.trim(), 10))
        .filter((value) => Number.isFinite(value) && value >= 0),
    ),
  ].sort((a, b) => a - b)
})()

const requestedIndex = (() => {
  if (!indexArg) return null
  const parsed = Number.parseInt(indexArg.split("=")[1] ?? "", 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
})()

const fixture =
  (await Bun.file(fixturePath).json()) as FailedHighDensityNodeCollection

const selectedNode = (() => {
  if (nodeIdArg) {
    const nodeId = nodeIdArg.split("=")[1]
    return fixture.failedHighDensityNodes.find(
      (entry) => entry.capacityMeshNodeId === nodeId,
    )
  }
  if (requestedIndex !== null) {
    return fixture.failedHighDensityNodes[requestedIndex]
  }
  return fixture.failedHighDensityNodes[0]
})()

if (!selectedNode) {
  throw new Error(
    `failed high density node not found in ${basename(fixturePath)}`,
  )
}

const fixtureSlug = basename(fixturePath, ".json")
const nodeSlug = selectedNode.capacityMeshNodeId.replaceAll("/", "_")
const outDir = resolve(
  outDirArg?.split("=")[1] ?? `tmp/a05-inspect-${fixtureSlug}-${nodeSlug}`,
)

const createCongestionOverlay = (
  solver: A05DiagnosticView,
  baselinePenalty2d: Float64Array,
) => {
  const penalty2d = solver.penalty2d
  const planeSize = solver.planeSize
  const vt = solver.gridToBoundsTransform
  const cellCenterX = solver.cellCenterX
  const cellCenterY = solver.cellCenterY
  const cellWidth = solver.cellWidth
  const cellHeight = solver.cellHeight

  if (
    !penalty2d ||
    planeSize === undefined ||
    !vt ||
    !cellCenterX ||
    !cellCenterY ||
    !cellWidth ||
    !cellHeight
  ) {
    return {
      rects: [] as NonNullable<GraphicsObject["rects"]>,
      summary: {
        activeCellCount: 0,
        maxDeltaPenalty: 0,
        weightedCentroid: null as { x: number; y: number } | null,
      },
    }
  }

  let maxDeltaPenalty = 0
  for (let cellId = 0; cellId < planeSize; cellId += 1) {
    const deltaPenalty = penalty2d[cellId]! - (baselinePenalty2d[cellId] ?? 0)
    if (deltaPenalty > maxDeltaPenalty) maxDeltaPenalty = deltaPenalty
  }

  if (maxDeltaPenalty <= 1e-9) {
    return {
      rects: [] as NonNullable<GraphicsObject["rects"]>,
      summary: {
        activeCellCount: 0,
        maxDeltaPenalty: 0,
        weightedCentroid: null as { x: number; y: number } | null,
      },
    }
  }

  const rects: NonNullable<GraphicsObject["rects"]> = []
  let activeCellCount = 0
  let weightedX = 0
  let weightedY = 0
  let totalWeight = 0

  for (let cellId = 0; cellId < planeSize; cellId += 1) {
    const deltaPenalty = penalty2d[cellId]! - (baselinePenalty2d[cellId] ?? 0)
    if (deltaPenalty <= 1e-9) continue

    const tc = applyAffineTransformToPoint(vt, {
      x: cellCenterX[cellId]!,
      y: cellCenterY[cellId]!,
    })
    const alpha = Math.min(0.4, (deltaPenalty / maxDeltaPenalty) * 0.4)

    rects.push({
      center: tc,
      width: cellWidth[cellId]! * vt.a,
      height: cellHeight[cellId]! * vt.e,
      fill: `rgba(255,0,0,${alpha.toFixed(3)})`,
      stroke: "rgba(255,80,80,0.16)",
    })

    activeCellCount += 1
    weightedX += tc.x * deltaPenalty
    weightedY += tc.y * deltaPenalty
    totalWeight += deltaPenalty
  }

  return {
    rects,
    summary: {
      activeCellCount,
      maxDeltaPenalty,
      weightedCentroid:
        totalWeight > 0
          ? {
              x: weightedX / totalWeight,
              y: weightedY / totalWeight,
            }
          : null,
    },
  }
}

const withCongestionOverlay = (
  graphics: GraphicsObject,
  solver: A05DiagnosticView,
  baselinePenalty2d: Float64Array,
): { graphics: GraphicsObject; summary: CheckpointReport["congestion"] } => {
  const congestion = createCongestionOverlay(solver, baselinePenalty2d)
  return {
    graphics: {
      ...graphics,
      rects: [...(graphics.rects ?? []), ...congestion.rects],
    },
    summary: congestion.summary,
  }
}

const renderGraphicsToPngBuffer = async (
  graphics: GraphicsObject,
  svgPath: string,
) => {
  const svg = getSvgFromGraphicsObject(graphics)
  await Bun.write(svgPath, svg)

  const outputDir = dirname(svgPath)
  const proc = Bun.spawnSync(
    ["qlmanage", "-t", "-s", "2048", "-o", outputDir, svgPath],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  if (proc.exitCode !== 0) {
    throw new Error(
      `qlmanage failed for ${basename(svgPath)}: ${new TextDecoder().decode(proc.stderr)}`,
    )
  }

  const renderedPngPath = `${svgPath}.png`
  return Bun.file(renderedPngPath).arrayBuffer()
}

const solver = new HighDensitySolverA05({
  ...defaultA05Params,
  nodeWithPortPoints: selectedNode.nodeWithPortPoints,
  showPenaltyMap: true,
  showUsedCellMap: true,
})
solver.MAX_ITERATIONS = 10_000_000
solver.setup()

const anySolver = solver as unknown as A05DiagnosticView
const baselinePenalty2d = Float64Array.from(anySolver.penalty2d ?? [])

const capturedGraphics: GraphicsObject[] = []
const checkpointReports: CheckpointReport[] = []

const captureCheckpoint = async (
  label: string,
  requestedIteration: number | "final",
) => {
  const currentGraphics = solver.visualize()
  const withOverlay = withCongestionOverlay(
    currentGraphics,
    anySolver,
    baselinePenalty2d,
  )
  const svgPath = join(outDir, `${label}.svg`)
  const pngPath = join(outDir, `${label}.png`)
  const pngBuffer = await renderGraphicsToPngBuffer(
    withOverlay.graphics,
    svgPath,
  )
  await Bun.write(pngPath, pngBuffer)

  capturedGraphics.push(withOverlay.graphics)
  checkpointReports.push({
    label,
    requestedIteration,
    iterations: solver.iterations,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    routes: solver.getOutput().length,
    totalRipEvents: anySolver.totalRipEvents ?? null,
    unsolvedSegments: anySolver.unsolvedSegs?.length ?? null,
    activeConnection:
      anySolver.activeConnId !== undefined &&
      anySolver.activeConnId >= 0 &&
      anySolver.connIdToName
        ? (anySolver.connIdToName[anySolver.activeConnId] ?? null)
        : null,
    congestion: withOverlay.summary,
  })
}

await mkdir(outDir, { recursive: true })

await captureCheckpoint("iter-000000", 0)

for (const checkpoint of requestedCheckpoints) {
  if (checkpoint === 0) continue

  while (solver.iterations < checkpoint && !solver.solved && !solver.failed) {
    solver.step()
  }

  const label = `iter-${String(solver.iterations).padStart(6, "0")}`
  await captureCheckpoint(label, checkpoint)

  if (solver.solved || solver.failed) break
}

if (!solver.solved && !solver.failed) {
  solver.solve()
}

const finalAlreadyCaptured = checkpointReports.some(
  (report) => report.iterations === solver.iterations,
)

if (!finalAlreadyCaptured) {
  await captureCheckpoint("final", "final")
}

const gridRows: GraphicsObject[][] = []
for (let index = 0; index < capturedGraphics.length; index += 3) {
  gridRows.push(capturedGraphics.slice(index, index + 3))
}
const stripGraphics = createGraphicsGrid(gridRows, {
  gapAsCellWidthFraction: 0.08,
})
const stripSvgPath = join(outDir, `${fixtureSlug}-${nodeSlug}-grid.svg`)
await Bun.write(stripSvgPath, getSvgFromGraphicsObject(stripGraphics))

const report = {
  fixturePath,
  outDir,
  source: fixture.source ?? null,
  effort: fixture.effort ?? null,
  collectionError: fixture.error ?? null,
  node: {
    capacityMeshNodeId: selectedNode.capacityMeshNodeId,
    solverType: selectedNode.solverType ?? null,
    extractedError: selectedNode.error ?? null,
    portCount: selectedNode.nodeWithPortPoints.portPoints.length,
    rootNetCount: new Set(
      selectedNode.nodeWithPortPoints.portPoints.map(
        (portPoint) =>
          portPoint.rootConnectionName ?? portPoint.connectionName,
      ),
    ).size,
    center: selectedNode.nodeWithPortPoints.center,
    width: selectedNode.nodeWithPortPoints.width,
    height: selectedNode.nodeWithPortPoints.height,
  },
  checkpoints: checkpointReports,
  final: {
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
    error: solver.error,
    routes: solver.getOutput().length,
    totalRipEvents: anySolver.totalRipEvents ?? null,
    unsolvedSegments: anySolver.unsolvedSegs?.length ?? null,
  },
  outputs: {
    stripSvgPath,
    checkpointPngPaths: checkpointReports.map((checkpoint) =>
      join(outDir, `${checkpoint.label}.png`),
    ),
  },
}

await Bun.write(
  join(outDir, `${fixtureSlug}-${nodeSlug}-report.json`),
  JSON.stringify(report, null, 2),
)

console.log(
  JSON.stringify(
    {
      fixturePath,
      nodeId: selectedNode.capacityMeshNodeId,
      outDir,
      stripSvgPath,
      final: report.final,
      checkpoints: checkpointReports.map((checkpoint) => ({
        label: checkpoint.label,
        iterations: checkpoint.iterations,
        totalRipEvents: checkpoint.totalRipEvents,
        unsolvedSegments: checkpoint.unsolvedSegments,
        activeConnection: checkpoint.activeConnection,
        congestion: checkpoint.congestion,
        error: checkpoint.error,
      })),
    },
    null,
    2,
  ),
)
