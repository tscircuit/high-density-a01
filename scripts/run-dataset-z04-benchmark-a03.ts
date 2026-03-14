import { runDatasetZ04Benchmark } from "./run-dataset-z04-benchmark-common"

await runDatasetZ04Benchmark({
  solverKey: "a03",
  solverLabel: "HighDensitySolverA03",
  defaultMode: "default",
  helpModeText: "default|repro",
  modeParser: (value) => (value === "repro" ? "repro" : "default"),
})
