export interface A01HeuristicContext {
  crossLayerSearch: boolean
  cellSizeMm: number
  minViaRow: number
  maxViaRow: number
  minViaCol: number
  maxViaCol: number
  hyperParameters: { viaBaseCost: number }
}

/** The heuristic from pinned control 10cdce5, kept as a numerical oracle. */
export function frozenA01Heuristic(
  this: A01HeuristicContext,
  z: number,
  row: number,
  col: number,
  toZ: number,
  toRow: number,
  toCol: number,
): number {
  const dr = Math.abs(row - toRow)
  const dc = Math.abs(col - toCol)
  const manhattan = dr + dc
  if (z === toZ) return manhattan * this.cellSizeMm
  if (!this.crossLayerSearch) {
    return manhattan * this.cellSizeMm + this.hyperParameters.viaBaseCost
  }
  const vr1 = Math.max(this.minViaRow, Math.min(this.maxViaRow, row))
  const vc1 = Math.max(this.minViaCol, Math.min(this.maxViaCol, col))
  const vr2 = Math.max(this.minViaRow, Math.min(this.maxViaRow, toRow))
  const vc2 = Math.max(this.minViaCol, Math.min(this.maxViaCol, toCol))
  const via1 =
    Math.abs(row - vr1) +
    Math.abs(col - vc1) +
    Math.abs(vr1 - toRow) +
    Math.abs(vc1 - toCol)
  const via2 =
    Math.abs(row - vr2) +
    Math.abs(col - vc2) +
    Math.abs(vr2 - toRow) +
    Math.abs(vc2 - toCol)
  return (
    Math.max(Math.min(via1, via2), manhattan) * this.cellSizeMm +
    this.hyperParameters.viaBaseCost
  )
}
