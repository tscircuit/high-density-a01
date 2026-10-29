const PAGE_LENGTH = 4096
const PAGED_MIN_LENGTH = (1024 * 1024) / Int32Array.BYTES_PER_ELEMENT

export class PagedOwnerStorage {
  // Store owner + 1 so unallocated pages and untouched cells both mean empty.
  private readonly pages: Array<Int32Array | undefined>

  constructor(readonly length: number) {
    this.pages = new Array(Math.ceil(length / PAGE_LENGTH))
  }

  get(index: number): number | undefined {
    if (index < 0 || index >= this.length || !Number.isInteger(index)) {
      return undefined
    }
    const page = this.pages[Math.floor(index / PAGE_LENGTH)]
    return page === undefined ? -1 : (page[index % PAGE_LENGTH]! - 1) | 0
  }

  set(index: number, owner: number): void {
    if (index < 0 || index >= this.length || !Number.isInteger(index)) return
    const encoded = ((owner | 0) + 1) | 0
    const pageIndex = Math.floor(index / PAGE_LENGTH)
    let page = this.pages[pageIndex]
    if (page === undefined) {
      if (encoded === 0) return
      page = new Int32Array(
        Math.min(PAGE_LENGTH, this.length - pageIndex * PAGE_LENGTH),
      )
      this.pages[pageIndex] = page
    }
    page[index % PAGE_LENGTH] = encoded
  }
}

export type OwnerStorage = Int32Array | PagedOwnerStorage

export function createOwnerStorage(length: number): OwnerStorage {
  if (
    Number.isInteger(length) &&
    length >= PAGED_MIN_LENGTH &&
    length <= 0x7fff_ffff
  ) {
    return new PagedOwnerStorage(length)
  }
  return new Int32Array(length).fill(-1)
}

export function readOwner(
  storage: OwnerStorage,
  index: number,
): number | undefined {
  return storage instanceof Int32Array ? storage[index] : storage.get(index)
}

export function writeOwner(
  storage: OwnerStorage,
  index: number,
  owner: number,
): void {
  if (storage instanceof Int32Array) storage[index] = owner
  else storage.set(index, owner)
}
