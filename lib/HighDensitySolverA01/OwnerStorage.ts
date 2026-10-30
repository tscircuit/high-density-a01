const PAGE_SHIFT = 12
const PAGE_LENGTH = 1 << PAGE_SHIFT
const PAGED_MIN_LENGTH = (1024 * 1024) / Int32Array.BYTES_PER_ELEMENT
const EMPTY_OWNER_PAGE = new Int32Array(PAGE_LENGTH).fill(-1)

export class PagedOwnerStorage {
  // Untouched slots share one empty page; writes replace a slot before editing.
  private readonly pages: Int32Array[]

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length < 0 || length > 0x7fff_ffff) {
      throw new RangeError("Invalid paged owner storage length")
    }
    this.pages = new Array<Int32Array>(Math.ceil(length / PAGE_LENGTH)).fill(
      EMPTY_OWNER_PAGE,
    )
  }

  get(index: number): number | undefined {
    if ((index >>> 0) !== index || index >= this.length) {
      return undefined
    }
    return this.pages[index >>> PAGE_SHIFT]![index & (PAGE_LENGTH - 1)]
  }

  set(index: number, owner: number): void {
    if ((index >>> 0) !== index || index >= this.length) return
    const normalizedOwner = owner | 0
    const pageIndex = index >>> PAGE_SHIFT
    let page = this.pages[pageIndex]!
    if (page === EMPTY_OWNER_PAGE) {
      if (normalizedOwner === -1) return
      page = new Int32Array(
        Math.min(PAGE_LENGTH, this.length - pageIndex * PAGE_LENGTH),
      ).fill(-1)
      this.pages[pageIndex] = page
    }
    page[index & (PAGE_LENGTH - 1)] = normalizedOwner
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
