import { runDatasetZ04Benchmark } from "./run-dataset-z04-benchmark-common"

await runDatasetZ04Benchmark({
  solverKey: "a05",
  solverLabel: "HighDensitySolverA05",
  defaultMode: "default",
  helpModeText: "default|repro",
  modeParser: (value) => (value === "repro" ? "repro" : "default"),
})
