import type { NodeWithPortPoints } from "../../lib/types"
import cmn13NodeWithPortPoints from "./cmn_13-node-with-port-points.json"

export type ReproDatasetEntry = {
  sampleName: string
  nodeId: string
  nodeWithPortPoints: NodeWithPortPoints
}

export type ReproDataset = {
  datasetName: string
  samples: ReproDatasetEntry[]
}

export const reproDataset = {
  datasetName: "repro-dataset",
  samples: [
    {
      sampleName: "cmn_13",
      nodeId: "cmn_13",
      nodeWithPortPoints: cmn13NodeWithPortPoints as NodeWithPortPoints,
    },
  ],
} satisfies ReproDataset

export const reproDatasetEntries = reproDataset.samples
