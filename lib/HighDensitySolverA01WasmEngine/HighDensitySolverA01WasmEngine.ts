import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import packageJson from "../../package.json"
import init, {
  HighDensitySolverA01Wasm,
  initSync,
} from "../../wasm/pkg/highdensity_solver_a01_wasm"
import {
  type AffineTransform,
  applyAffineTransformToPoint,
  computeGridToAffineTransform,
} from "../gridToAffineTransform"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../types"

type HyperParameters = {
  shuffleSeed: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  viaBaseCost: number
  greedyMultiplier: number
}

export interface HighDensitySolverA01WasmEngineProps {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  traceThickness?: number
  traceMargin?: number
  viaMinDistFromBorder?: number
  showPenaltyMap?: boolean
  showUsedCellMap?: boolean
  hyperParameters?: Partial<HyperParameters>
  /** TS convenience: if provided, gets precomputed into a penaltyMap for WASM */
  initialPenaltyFn?: (params: {
    x: number
    y: number
    px: number
    py: number
    row: number
    col: number
  }) => number
  /** Direct penalty map [row][col] — alternative to initialPenaltyFn */
  penaltyMap?: number[][]
}

let wasmReady: Promise<void> | null = null

/**
 * Initialize the WASM module. Must be awaited before constructing the solver.
 * Safe to call multiple times — only the first call loads the module.
 *
 * In Node/Bun environments, reads the .wasm file from disk.
 * In browsers, pass a URL or use the default fetch-based init.
 */
export async function initHighDensitySolverWasm(
  input?: Parameters<typeof init>[0],
): Promise<void> {
  if (wasmReady) return wasmReady

  wasmReady = (async () => {
    if (input) {
      await init(input)
      return
    }

    // Node/Bun: read .wasm from disk and use initSync
    if (
      typeof globalThis.process !== "undefined" &&
      globalThis.process.versions
    ) {
      const { readFileSync, existsSync } = await import("fs")
      const { resolve, dirname } = await import("path")
      const { fileURLToPath } = await import("url")
      const dir = dirname(fileURLToPath(import.meta.url))
      // Built dist/ has the .wasm copied alongside; source tree has it under wasm/pkg/
      const distPath = resolve(dir, "highdensity_solver_a01_wasm_bg.wasm")
      const srcPath = resolve(
        dir,
        "../../wasm/pkg/highdensity_solver_a01_wasm_bg.wasm",
      )
      const wasmPath = existsSync(distPath) ? distPath : srcPath
      const wasmBytes = readFileSync(wasmPath)
      initSync({ module: wasmBytes })
      return
    }

    // Browser: use env override or fetch from jsdelivr
    const cdnUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as any).env?.VITE_TSCIRCUIT_HIGH_DENSITY_A01_WASM_URL) ||
      `https://cdn.jsdelivr.net/npm/@tscircuit/high-density-a01@${packageJson.version}/dist/highdensity_solver_a01_wasm_bg.wasm`
    await init(cdnUrl)
  })()

  return wasmReady
}

function computePenaltyMap(
  props: HighDensitySolverA01WasmEngineProps,
): number[][] | undefined {
  if (props.penaltyMap) return props.penaltyMap

  const { initialPenaltyFn } = props
  if (!initialPenaltyFn) return undefined

  const { width, height, center } = props.nodeWithPortPoints
  const rows = Math.ceil(height / props.cellSizeMm)
  const cols = Math.ceil(width / props.cellSizeMm)
  const originX = center.x - width / 2
  const originY = center.y - height / 2

  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const x = originX + (col + 0.5) * props.cellSizeMm
      const y = originY + (row + 0.5) * props.cellSizeMm
      const px = (col + 0.5) / cols
      const py = (row + 0.5) / rows
      return initialPenaltyFn({ x, y, px, py, row, col })
    }),
  )
}

export class HighDensitySolverA01WasmEngine extends BaseSolver {
  private props: HighDensitySolverA01WasmEngineProps
  private wasm!: HighDensitySolverA01Wasm
  private gridToBoundsTransform!: AffineTransform

  constructor(props: HighDensitySolverA01WasmEngineProps) {
    super()
    this.props = props
    this.MAX_ITERATIONS = 1e6
  }

  override _setup(): void {
    // IMPORTANT: call `await initHighDensitySolverWasm()` before using this solver.
    const penaltyMap = computePenaltyMap(this.props)

    const { width, height, center } = this.props.nodeWithPortPoints
    const originX = center.x - width / 2
    const originY = center.y - height / 2
    const rows = Math.floor(height / this.props.cellSizeMm)
    const cols = Math.floor(width / this.props.cellSizeMm)

    this.gridToBoundsTransform = computeGridToAffineTransform({
      originX,
      originY,
      rows,
      cols,
      cellSizeMm: this.props.cellSizeMm,
      width,
      height,
    })

    this.wasm = new HighDensitySolverA01Wasm({
      nodeWithPortPoints: this.props.nodeWithPortPoints,
      cellSizeMm: this.props.cellSizeMm,
      viaDiameter: this.props.viaDiameter,
      traceThickness: this.props.traceThickness,
      traceMargin: this.props.traceMargin,
      viaMinDistFromBorder: this.props.viaMinDistFromBorder,
      showPenaltyMap: this.props.showPenaltyMap,
      showUsedCellMap: this.props.showUsedCellMap,
      hyperParameters: this.props.hyperParameters,
      penaltyMap,
    })

    this.wasm.setup()
  }

  override _step(): void {
    this.wasm.step()

    // Keep BaseSolver flags in sync
    this.solved = this.wasm.is_solved()
    this.failed = this.wasm.is_failed()
    this.error = this.wasm.error() ?? null
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const routes =
      this.wasm.get_output() as unknown as HighDensityIntraNodeRoute[]
    const t = this.gridToBoundsTransform
    for (const route of routes) {
      for (let i = 0; i < route.route.length; i++) {
        const pt = route.route[i]!
        const tp = applyAffineTransformToPoint(t, pt)
        route.route[i] = { x: tp.x, y: tp.y, z: pt.z }
      }
      for (let i = 0; i < route.vias.length; i++) {
        route.vias[i] = applyAffineTransformToPoint(t, route.vias[i]!)
      }
    }
    return routes
  }

  override visualize(): GraphicsObject {
    const LAYER_COLORS = ["red", "blue", "orange", "green"]
    const TRACE_COLORS = [
      "rgba(255,0,0,0.75)",
      "rgba(0,0,255,0.75)",
      "rgba(255,165,0,0.75)",
      "rgba(0,128,0,0.75)",
    ]

    const points: GraphicsObject["points"] = []
    const lines: GraphicsObject["lines"] = []
    const circles: GraphicsObject["circles"] = []
    const rects: GraphicsObject["rects"] = []

    const { width, height, center } = this.props.nodeWithPortPoints
    const traceThickness = this.props.traceThickness ?? 0.1
    const viaDiameter = this.props.viaDiameter

    // Grid bounds
    rects!.push({
      center: { x: center.x, y: center.y },
      width,
      height,
      stroke: "gray",
    })

    // Port points colored by layer
    for (const pp of this.props.nodeWithPortPoints.portPoints) {
      points!.push({
        x: pp.x,
        y: pp.y,
        color: LAYER_COLORS[pp.z] ?? "gray",
        label: pp.connectionName,
      })
    }

    // Solved routes split by z-layer for correct coloring
    const routes = this.getOutput()
    for (const route of routes) {
      if (route.route.length < 2) continue

      let segStart = 0
      for (let i = 1; i < route.route.length; i++) {
        const prev = route.route[i - 1]!
        const curr = route.route[i]!
        if (curr.z !== prev.z) {
          if (i - segStart >= 2) {
            lines!.push({
              points: route.route
                .slice(segStart, i)
                .map((p) => ({ x: p.x, y: p.y })),
              strokeColor: TRACE_COLORS[prev.z] ?? "rgba(128,128,128,0.75)",
              strokeWidth: traceThickness,
            })
          }
          segStart = i
        }
      }
      // Final segment
      if (route.route.length - segStart >= 2) {
        const lastZ = route.route[segStart]!.z
        lines!.push({
          points: route.route.slice(segStart).map((p) => ({ x: p.x, y: p.y })),
          strokeColor: TRACE_COLORS[lastZ] ?? "rgba(128,128,128,0.75)",
          strokeWidth: traceThickness,
        })
      }
    }

    // Vias
    for (const route of routes) {
      for (const via of route.vias) {
        circles!.push({
          center: { x: via.x, y: via.y },
          radius: viaDiameter / 2,
          fill: "rgba(0,0,0,0.3)",
          stroke: "black",
        })
      }
    }

    return {
      points,
      lines,
      circles,
      rects,
      coordinateSystem: "cartesian" as const,
      title: `HighDensityA01 WASM [${routes.length} solved]`,
    }
  }
}
