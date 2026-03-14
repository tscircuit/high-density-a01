import { runDatasetZ04Benchmark } from "./run-dataset-z04-benchmark-common"

await runDatasetZ04Benchmark({
  solverKey: "a02",
  solverLabel: "HighDensitySolverA02",
  defaultMode: "fast",
  helpModeText: "fast|strict",
  modeParser: (value) => (value === "strict" ? "strict" : "fast"),
})
