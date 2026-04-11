import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { useEffect, useState } from "react"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA02 } from "../../lib/HighDensitySolverA02/HighDensitySolverA02"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import { HighDensitySolverA05 } from "../../lib/HighDensitySolverA05/HighDensitySolverA05"
import {
  defaultA02Params,
  defaultA03Params,
  defaultA05Params,
  defaultParams,
} from "../../lib/default-params"
import type { NodeWithPortPoints } from "../../lib/types"

type SolverKey = "a01" | "a02" | "a03" | "a05"

const STORAGE_KEY = "high-density:selected-solver"

const SOLVER_OPTIONS: Array<{ label: string; value: SolverKey }> = [
  { label: "A01", value: "a01" },
  { label: "A02", value: "a02" },
  { label: "A03", value: "a03" },
  { label: "A05", value: "a05" },
]
const ALL_SOLVER_KEYS = SOLVER_OPTIONS.map((option) => option.value)

const isSolverKey = (value: string | null): value is SolverKey =>
  value === "a01" || value === "a02" || value === "a03" || value === "a05"

const getInitialSolverKey = (fallback: SolverKey) => {
  if (typeof window === "undefined") return fallback
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isSolverKey(stored) ? stored : fallback
}

type SolverDebuggerProps = {
  nodeWithPortPoints: NodeWithPortPoints
  defaultSolverKey?: SolverKey
  solverKeys?: readonly SolverKey[]
  debugKey?: string
  maxIterations?: number
}

export function SolverDebugger({
  nodeWithPortPoints,
  defaultSolverKey = "a03",
  solverKeys,
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
          let solver:
            | HighDensitySolverA01
            | HighDensitySolverA02
            | HighDensitySolverA03
            | HighDensitySolverA05

          switch (solverKey) {
            case "a01":
              solver = new HighDensitySolverA01({
                ...defaultParams,
                nodeWithPortPoints,
              })
              break
            case "a02":
              solver = new HighDensitySolverA02({
                ...defaultA02Params,
                nodeWithPortPoints,
              })
              break
            case "a03":
              solver = new HighDensitySolverA03({
                ...defaultA03Params,
                nodeWithPortPoints,
              })
              break
            case "a05":
              solver = new HighDensitySolverA05({
                ...defaultA05Params,
                nodeWithPortPoints,
              })
              break
          }

          solver.MAX_ITERATIONS = maxIterations
          solver.setup()
          return solver
        }}
      />
    </div>
  )
}
