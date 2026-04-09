import { useState } from "react"
import { SolverDebugger } from "../components/SolverDebugger"
import { datasetFails03Entries } from "./dataset-fails03"

const getRootNetCount = (entry: (typeof datasetFails03Entries)[number]) =>
  new Set(
    entry.nodeWithPortPoints.portPoints.map(
      (portPoint) => portPoint.rootConnectionName ?? portPoint.connectionName,
    ),
  ).size

export default function DatasetFails03SelectorFixture() {
  const [sampleNumberInput, setSampleNumberInput] = useState("1")

  const maxSampleNumber = datasetFails03Entries.length
  const parsedSampleNumber = Number.parseInt(sampleNumberInput, 10)
  const safeSampleNumber = Number.isFinite(parsedSampleNumber)
    ? Math.min(Math.max(parsedSampleNumber, 1), maxSampleNumber)
    : 1
  const sampleIndex = safeSampleNumber - 1
  const sample = datasetFails03Entries[sampleIndex] ?? datasetFails03Entries[0]

  if (!sample) {
    return <div>Dataset fails03 is empty.</div>
  }

  const portCount = sample.nodeWithPortPoints.portPoints.length
  const rootNetCount = getRootNetCount(sample)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="dataset-fails03-sample-number">Dataset fails03 #</label>
        <input
          id="dataset-fails03-sample-number"
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
          Scenario <strong>{sample.scenarioName}</strong> /{" "}
          <code>{sample.capacityMeshNodeId}</code>
        </div>
        <div>
          Ports: {portCount}, root nets: {rootNetCount}, size:{" "}
          {sample.nodeWithPortPoints.width.toFixed(3)} x{" "}
          {sample.nodeWithPortPoints.height.toFixed(3)}
        </div>
        <div>
          Extracted from {sample.solverName} ({sample.solverType})
        </div>
        <div style={{ whiteSpace: "pre-wrap" }}>{sample.error}</div>
      </div>

      <SolverDebugger
        nodeWithPortPoints={sample.nodeWithPortPoints}
        defaultSolverKey="a05"
        debugKey={`dataset-fails03-${safeSampleNumber}`}
      />
    </div>
  )
}
