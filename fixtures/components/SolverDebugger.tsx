import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { useEffect, useState } from "react"
import {
  HighDensitySolverA01,
  type HighDensitySolverA01Props,
} from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import {
  HighDensitySolverA02,
  type HighDensitySolverA02Props,
} from "../../lib/HighDensitySolverA02/HighDensitySolverA02"
import {
  HighDensitySolverA03,
  type HighDensitySolverA03Props,
} from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import {
  HighDensitySolverA05,
  type HighDensitySolverA05Props,
} from "../../lib/HighDensitySolverA05/HighDensitySolverA05"
import {
  HighDensitySolverA08,
  type HighDensitySolverA08Props,
} from "../../lib/HighDensitySolverA08/HighDensitySolverA08"
import {
  HighDensitySolverA09,
  type HighDensitySolverA09Props,
} from "../../lib/HighDensitySolverA09/HighDensitySolverA09"
import {
  defaultA02Params,
  defaultA03Params,
  defaultA05Params,
  defaultA08Params,
  defaultA09Params,
  defaultParams,
} from "../../lib/default-params"
import type { NodeWithPortPoints } from "../../lib/types"

type SolverKey = "a01" | "a02" | "a03" | "a05" | "a08" | "a09"
type SolverPropsByKey = {
  a01: Partial<Omit<HighDensitySolverA01Props, "nodeWithPortPoints">>
  a02: Partial<Omit<HighDensitySolverA02Props, "nodeWithPortPoints">>
  a03: Partial<Omit<HighDensitySolverA03Props, "nodeWithPortPoints">>
  a05: Partial<Omit<HighDensitySolverA05Props, "nodeWithPortPoints">>
  a08: Partial<Omit<HighDensitySolverA08Props, "nodeWithPortPoints">>
  a09: Partial<Omit<HighDensitySolverA09Props, "nodeWithPortPoints">>
}

const STORAGE_KEY = "high-density:selected-solver"

const SOLVER_OPTIONS: Array<{ label: string; value: SolverKey }> = [
  { label: "A01", value: "a01" },
  { label: "A02", value: "a02" },
  { label: "A03", value: "a03" },
  { label: "A05", value: "a05" },
  { label: "A08", value: "a08" },
  { label: "A09", value: "a09" },
]
const ALL_SOLVER_KEYS = SOLVER_OPTIONS.map((option) => option.value)

const isSolverKey = (value: string | null): value is SolverKey =>
  value === "a01" ||
  value === "a02" ||
  value === "a03" ||
  value === "a05" ||
  value === "a08" ||
  value === "a09"

const getInitialSolverKey = (fallback: SolverKey) => {
  if (typeof window === "undefined") return fallback
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isSolverKey(stored) ? stored : fallback
}

type SolverDebuggerProps = {
  nodeWithPortPoints: NodeWithPortPoints
  defaultSolverKey?: SolverKey
  solverKeys?: readonly SolverKey[]
  solverPropOverrides?: Partial<SolverPropsByKey>
  debugKey?: string
  maxIterations?: number
}

export function SolverDebugger({
  nodeWithPortPoints,
  defaultSolverKey = "a03",
  solverKeys,
  solverPropOverrides,
  debugKey,
  maxIterations = 10_000_000,
}: SolverDebuggerProps) {
  const allowedSolverKeys =
    solverKeys && solverKeys.length > 0 ? solverKeys : ALL_SOLVER_KEYS
  const fallbackSolverKey = allowedSolverKeys.includes(defaultSolverKey)
    ? defaultSolverKey
    : (allowedSolverKeys[0] ?? "a03")
  const solverOptions = SOLVER_OPTIONS.filter((option) =>
    allowedSolverKeys.includes(option.value),
  )
  const [solverKey, setSolverKey] = useState<SolverKey>(() => {
    const storedSolverKey = getInitialSolverKey(fallbackSolverKey)
    return allowedSolverKeys.includes(storedSolverKey)
      ? storedSolverKey
      : fallbackSolverKey
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, solverKey)
  }, [solverKey])

  useEffect(() => {
    if (allowedSolverKeys.includes(solverKey)) return
    setSolverKey(fallbackSolverKey)
  }, [allowedSolverKeys, fallbackSolverKey, solverKey])

  const prepareSolver = <TSolver extends object>(solver: TSolver) => {
    const configuredSolver = solver as TSolver & {
      MAX_ITERATIONS: number
      setup: () => void
    }

    configuredSolver.MAX_ITERATIONS = maxIterations
    configuredSolver.setup()
    return configuredSolver
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="solver-select">Solver</label>
        <select
          id="solver-select"
          value={solverKey}
          onChange={(event) =>
            setSolverKey(event.currentTarget.value as SolverKey)
          }
        >
          {solverOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <GenericSolverDebugger
        key={`${debugKey ?? nodeWithPortPoints.capacityMeshNodeId}-${solverKey}`}
        createSolver={() => {
          switch (solverKey) {
            case "a01":
              return prepareSolver(
                new HighDensitySolverA01({
                  ...defaultParams,
                  nodeWithPortPoints,
                  ...solverPropOverrides?.a01,
                }),
              )
            case "a02":
              return prepareSolver(
                new HighDensitySolverA02({
                  ...defaultA02Params,
                  nodeWithPortPoints,
                  ...solverPropOverrides?.a02,
                }),
              )
            case "a03":
              return prepareSolver(
                new HighDensitySolverA03({
                  ...defaultA03Params,
                  nodeWithPortPoints,
                  ...solverPropOverrides?.a03,
                }),
              )
            case "a05":
              return prepareSolver(
                new HighDensitySolverA05({
                  ...defaultA05Params,
                  nodeWithPortPoints,
                  ...solverPropOverrides?.a05,
                }),
              )
            case "a08":
              return prepareSolver(
                new HighDensitySolverA08({
                  ...defaultA08Params,
                  nodeWithPortPoints,
                  ...solverPropOverrides?.a08,
                }),
              )
            case "a09":
              return prepareSolver(
                new HighDensitySolverA09({
                  ...defaultA09Params,
                  nodeWithPortPoints,
                  ...solverPropOverrides?.a09,
                }),
              )
          }

          throw new Error(`Unsupported solver key: ${solverKey}`)
        }}
      />
    </div>
  )
}
