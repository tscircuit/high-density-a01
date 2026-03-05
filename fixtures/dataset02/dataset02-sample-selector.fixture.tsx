import dataset02Json from "@tscircuit/hypergraph/datasets/jumper-graph-solver/dataset02.json"
import { GenericSolverDebugger } from "@tscircuit/solver-utils/react"
import { useMemo, useState } from "react"
import {
  convertDataset02SampleToNodeWithPortPoints,
  type Dataset02Sample,
} from "../../lib/dataset02/convertDataset02SampleToNodeWithPortPoints"
import { defaultParams } from "../../lib/default-params"
import { HighDensitySolverA01 } from "../../lib/HighDensitySolverA01/HighDensitySolverA01"

const dataset02 = dataset02Json as Dataset02Sample[]

export default function Dataset02SampleSelectorFixture() {
  const [sampleNumberInput, setSampleNumberInput] = useState("1")

  const maxSampleNumber = dataset02.length
  const parsedSampleNumber = Number.parseInt(sampleNumberInput, 10)
  const safeSampleNumber = Number.isFinite(parsedSampleNumber)
    ? Math.min(Math.max(parsedSampleNumber, 1), maxSampleNumber)
    : 1
  const sampleIndex = safeSampleNumber - 1
  const sample = dataset02[sampleIndex] ?? dataset02[0]

  if (!sample) {
    return <div>Dataset02 is empty.</div>
  }

  const nodeWithPortPoints = useMemo(() => {
    return convertDataset02SampleToNodeWithPortPoints(sample, {
      capacityMeshNodeId: `dataset02-${safeSampleNumber}`,
      availableZ: [0, 1],
    })
  }, [sample, safeSampleNumber])

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="dataset02-sample-number">Dataset02 sample #</label>
        <input
          id="dataset02-sample-number"
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

      <GenericSolverDebugger
        key={`dataset02-${safeSampleNumber}`}
        createSolver={() => {
          const solver = new HighDensitySolverA01({
            ...defaultParams,
            nodeWithPortPoints,
          })
          solver.MAX_ITERATIONS = 10_000_000
          solver.setup()
          return solver
        }}
      />
    </div>
  )
}
