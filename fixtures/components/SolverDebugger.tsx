import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { useEffect, useState } from "react"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"
import { HighDensitySolverA02 } from "../../lib/HighDensitySolverA02/HighDensitySolverA02"
import { HighDensitySolverA03 } from "../../lib/HighDensitySolverA03/HighDensitySolverA03"
import {
  defaultA02Params,
  defaultA03Params,
  defaultParams,
} from "../../lib/default-params"
import type { NodeWithPortPoints } from "../../lib/types"

type SolverKey = "a01" | "a02" | "a03"

const STORAGE_KEY = "high-density:selected-solver"

const SOLVER_OPTIONS: Array<{ label: string; value: SolverKey }> = [
  { label: "A01", value: "a01" },
  { label: "A02", value: "a02" },
  { label: "A03", value: "a03" },
]

const isSolverKey = (value: string | null): value is SolverKey =>
  value === "a01" || value === "a02" || value === "a03"

const getInitialSolverKey = (fallback: SolverKey) => {
  if (typeof window === "undefined") return fallback
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isSolverKey(stored) ? stored : fallback
}

type SolverDebuggerProps = {
  nodeWithPortPoints: NodeWithPortPoints
  defaultSolverKey?: SolverKey
  debugKey?: string
  maxIterations?: number
}

export function SolverDebugger({
  nodeWithPortPoints,
  defaultSolverKey = "a03",
  debugKey,
  maxIterations = 10_000_000,
}: SolverDebuggerProps) {
  const [solverKey, setSolverKey] = useState<SolverKey>(() =>
    getInitialSolverKey(defaultSolverKey),
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, solverKey)
  }, [solverKey])

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
          {SOLVER_OPTIONS.map((option) => (
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
          }

          solver.MAX_ITERATIONS = maxIterations
          solver.setup()
          return solver
        }}
      />
    </div>
  )
}
