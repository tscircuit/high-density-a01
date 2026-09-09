export interface OccupiedRowRun {
  start: number
  end: number
  owner: number
}

/** Sorted maximal equal-owner intervals; -1 cells are omitted. */
export class OccupiedRowRuns {
  readonly rows: Array<OccupiedRowRun[] | undefined>

  constructor(
    private readonly columnCount: number,
    rowCount: number,
  ) {
    this.rows = new Array(rowCount)
  }

  set(flatIndex: number, owner: number): void {
    const rowIndex = Math.floor(flatIndex / this.columnCount)
    const column = flatIndex - rowIndex * this.columnCount
    const runs = this.rows[rowIndex]
    if (!runs) {
      if (owner !== -1) {
        this.rows[rowIndex] = [{ start: column, end: column, owner }]
      }
      return
    }

    let left = 0
    let right = runs.length
    while (left < right) {
      const mid = (left + right) >>> 1
      if (runs[mid]!.end < column) left = mid + 1
      else right = mid
    }
    let index = left
    const existing = runs[index]
    if (existing && existing.start <= column) {
      if (existing.owner === owner) return
      if (existing.start === column) {
        if (existing.end === column) runs.splice(index, 1)
        else existing.start++
      } else if (existing.end === column) {
        existing.end--
        index++
      } else {
        const end = existing.end
        existing.end = column - 1
        runs.splice(index + 1, 0, {
          start: column + 1,
          end,
          owner: existing.owner,
        })
        index++
      }
    }

    if (owner === -1) {
      if (runs.length === 0) this.rows[rowIndex] = undefined
      return
    }

    const previous = runs[index - 1]
    const next = runs[index]
    const joinsPrevious =
      previous && previous.end === column - 1 && previous.owner === owner
    const joinsNext = next && next.start === column + 1 && next.owner === owner
    if (joinsPrevious) {
      previous.end = joinsNext ? next.end : column
      if (joinsNext) runs.splice(index, 1)
    } else if (joinsNext) {
      next.start = column
    } else {
      runs.splice(index, 0, { start: column, end: column, owner })
    }
  }
}
