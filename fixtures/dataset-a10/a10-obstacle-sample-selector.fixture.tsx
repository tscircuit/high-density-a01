import { useState } from "react"
import { SolverDebugger } from "../components/SolverDebugger"
import { a10ObstacleDataset } from "./a10-obstacle-dataset"

export default function A10ObstacleSampleSelectorFixture() {
  const [sampleNumberInput, setSampleNumberInput] = useState("1")

  const maxSampleNumber = a10ObstacleDataset.length
  const parsedSampleNumber = Number.parseInt(sampleNumberInput, 10)
  const safeSampleNumber = Number.isFinite(parsedSampleNumber)
    ? Math.min(Math.max(parsedSampleNumber, 1), maxSampleNumber)
    : 1
  const sampleIndex = safeSampleNumber - 1
  const sample = a10ObstacleDataset[sampleIndex] ?? a10ObstacleDataset[0]

  if (!sample) {
    return <div>A10 obstacle dataset is empty.</div>
  }

  const layerSummary = sample.obstacles
    .map((obstacle) => obstacle.layers?.join("/") ?? "all")
    .join(", ")

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <label htmlFor="dataset-a10-sample-number">A10 obstacle sample #</label>
        <input
          id="dataset-a10-sample-number"
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
          <strong>{sample.sampleId}</strong> /{" "}
          <code>{sample.nodeWithPortPoints.capacityMeshNodeId}</code>
        </div>
        <div>
          Node: {sample.nodeSizeMm} x {sample.nodeSizeMm}mm, obstacles:{" "}
          {sample.obstacles.length}, margin: {sample.obstacleMargin}mm
        </div>
        <div>Obstacle layers: {layerSummary}</div>
      </div>

      <SolverDebugger
        nodeWithPortPoints={sample.nodeWithPortPoints}
        defaultSolverKey="a10"
        solverKeys={["a10", "a01"]}
        solverPropOverrides={{
          a10: {
            obstacles: sample.obstacles,
            obstacleMargin: sample.obstacleMargin,
            effort: 2,
            showUsedCellMap: true,
          },
        }}
        debugKey={`dataset-a10-${safeSampleNumber}`}
      />
    </div>
  )
}
