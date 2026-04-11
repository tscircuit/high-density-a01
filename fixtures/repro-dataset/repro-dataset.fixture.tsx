import { useState } from "react"
import { SolverDebugger } from "../components/SolverDebugger"
import { reproDatasetEntries } from "./repro-dataset"

const A_SERIES_SOLVER_KEYS = ["a01", "a03", "a05"] as const

const getRootNetCount = (entry: (typeof reproDatasetEntries)[number]) =>
  new Set(
    entry.nodeWithPortPoints.portPoints.map(
      (portPoint) => portPoint.rootConnectionName ?? portPoint.connectionName,
    ),
  ).size

export default function ReproDatasetFixture() {
  const [sampleNumberInput, setSampleNumberInput] = useState("1")

  const maxSampleNumber = reproDatasetEntries.length
  const parsedSampleNumber = Number.parseInt(sampleNumberInput, 10)
  const safeSampleNumber = Number.isFinite(parsedSampleNumber)
    ? Math.min(Math.max(parsedSampleNumber, 1), maxSampleNumber)
    : 1
  const sampleIndex = safeSampleNumber - 1
  const sample = reproDatasetEntries[sampleIndex] ?? reproDatasetEntries[0]

  if (!sample) {
    return <div>Repro dataset is empty.</div>
  }

  const portCount = sample.nodeWithPortPoints.portPoints.length
  const rootNetCount = getRootNetCount(sample)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="repro-dataset-sample-number">Repro dataset #</label>
        <input
          id="repro-dataset-sample-number"
          type="number"
          min={1}
          max={maxSampleNumber}
          value={sampleNumberInput}
          onChange={(event) => setSampleNumberInput(event.currentTarget.value)}
          style={{ width: 96 }}
        />
        <button
          type="button"
          onClick={() =>
            setSampleNumberInput(String(Math.max(1, safeSampleNumber - 1)))
          }
        >
          Prev
        </button>
        <button
          type="button"
          onClick={() =>
            setSampleNumberInput(
              String(Math.min(maxSampleNumber, safeSampleNumber + 1)),
            )
          }
        >
          Next
        </button>
        <span>
          Showing {safeSampleNumber} / {maxSampleNumber}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div>
          Sample <strong>{sample.sampleName}</strong> /{" "}
          <code>{sample.nodeId}</code>
        </div>
        <div>
          Ports: {portCount}, root nets: {rootNetCount}, size:{" "}
          {sample.nodeWithPortPoints.width.toFixed(3)} x{" "}
          {sample.nodeWithPortPoints.height.toFixed(3)}
        </div>
        <div>
          Layers:{" "}
          {sample.nodeWithPortPoints.availableZ?.join(", ") ??
            "derived from port points"}
        </div>
      </div>

      <SolverDebugger
        nodeWithPortPoints={sample.nodeWithPortPoints}
        solverKeys={A_SERIES_SOLVER_KEYS}
        defaultSolverKey="a01"
        debugKey={`repro-dataset-${sample.sampleName}`}
      />
    </div>
  )
}
