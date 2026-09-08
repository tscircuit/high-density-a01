// The reference below is the exact 8e363 heap, with only type names changed.
// Compare full entry storage after every operation, not merely popped IDs.
use super::{Heap, HeapEntry};
use std::mem::{align_of, offset_of, size_of};

#[derive(Clone, Copy)]
struct ReferenceEntry {
    f: f64,
    id: u32,
}

#[derive(Default)]
struct ReferenceHeap {
    entries: Vec<ReferenceEntry>,
}
impl ReferenceHeap {
    fn clear(&mut self) {
        self.entries.clear();
    }
    fn push(&mut self, f: f64, id: u32) {
        let entry = ReferenceEntry { f, id };
        let mut i = self.entries.len();
        self.entries.push(entry);
        while i > 0 {
            let p = (i - 1) >> 1;
            let parent = self.entries[p];
            if if parent.f != f {
                parent.f < f
            } else {
                parent.id < id
            } {
                break;
            }
            self.entries[i] = parent;
            i = p;
        }
        self.entries[i] = entry;
    }
    fn pop(&mut self) -> u32 {
        let out = self.entries[0].id;
        let entry = self.entries.pop().unwrap();
        let n = self.entries.len();
        if n > 0 {
            let mut i = 0;
            loop {
                let left = i * 2 + 1;
                if left >= n {
                    break;
                }
                let right = left + 1;
                let mut child = left;
                if right < n {
                    let left_entry = self.entries[left];
                    let right_entry = self.entries[right];
                    if !(if left_entry.f != right_entry.f {
                        left_entry.f < right_entry.f
                    } else {
                        left_entry.id < right_entry.id
                    }) {
                        child = right;
                    }
                }
                let child_entry = self.entries[child];
                if if entry.f != child_entry.f {
                    entry.f < child_entry.f
                } else {
                    entry.id < child_entry.id
                } {
                    break;
                }
                self.entries[i] = child_entry;
                i = child;
            }
            self.entries[i] = entry;
        }
        out
    }
}

fn assert_entries(actual: &Heap, expected: &ReferenceHeap) {
    assert_eq!(actual.entries.len(), expected.entries.len());
    assert_eq!(actual.entries.capacity(), expected.entries.capacity());
    for (a, b) in actual.entries.iter().zip(&expected.entries) {
        // By-value copies are required: references to a packed f64 are unaligned.
        let (f, id) = (a.f, a.id);
        assert_eq!(f.to_bits(), b.f.to_bits());
        assert_eq!(id, b.id);
    }
}

#[test]
fn entry_layout_is_twelve_bytes_without_changing_any_other_search_type() {
    assert_eq!(size_of::<ReferenceEntry>(), 16);
    assert_eq!(size_of::<HeapEntry>(), 12);
    assert_eq!(align_of::<HeapEntry>(), 4);
    assert_eq!(offset_of!(HeapEntry, f), 0);
    assert_eq!(offset_of!(HeapEntry, id), 8);
    assert_eq!(size_of::<super::SearchNode>(), 24);
    assert_eq!(size_of::<super::Rip>(), 8);
    let mut heap = Heap::default();
    for id in 0..1025 {
        heap.push(id as f64, id);
    }
    assert_eq!(
        heap.entries.as_ptr().wrapping_add(1) as usize - heap.entries.as_ptr() as usize,
        12
    );
    assert_eq!(
        heap.entries.capacity() * size_of::<HeapEntry>() * 4,
        heap.entries.capacity() * size_of::<ReferenceEntry>() * 3
    );
}

#[test]
fn packed_heap_matches_frozen_heap_for_bits_ties_growth_clear_and_reuse() {
    let priorities: [u64; 20] = [
        0,
        0x8000_0000_0000_0000,
        0x7ff0_0000_0000_0000,
        0xfff0_0000_0000_0000,
        0x7ff8_0000_0000_0001,
        0x7ff0_0000_0000_0001,
        0xfff8_0012_3456_789a,
        0xfff0_0000_0000_0001,
        1,
        0x8000_0000_0000_0001,
        0x000f_ffff_ffff_ffff,
        0x0010_0000_0000_0000,
        0x7fef_ffff_ffff_ffff,
        0xffef_ffff_ffff_ffff,
        0x3ff0_0000_0000_0000,
        0xbff0_0000_0000_0000,
        0x3ff0_0000_0000_0000,
        0x4000_0000_0000_0000,
        0x4008_0000_0000_0000,
        0x3fe0_0000_0000_0000,
    ];
    let mut operations = 0usize;
    for seed in 1..=24u64 {
        let mut rng = seed;
        let mut actual = Heap::default();
        let mut expected = ReferenceHeap::default();
        for step in 0..8192 {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            if step % 2048 == 2047 {
                actual.clear();
                expected.clear();
            } else if actual.entries.is_empty() || (actual.entries.len() < 192 && rng % 10 < 6) {
                let f = if seed % 3 == 0 {
                    ((rng >> 20) % 8) as f64
                } else if rng % 3 == 0 {
                    f64::from_bits(rng)
                } else {
                    f64::from_bits(priorities[(rng as usize) % priorities.len()])
                };
                let id = match rng % 5 {
                    0 => u32::MAX,
                    1 => 0,
                    2 => (rng % 8) as u32,
                    _ => (rng >> 32) as u32,
                };
                actual.push(f, id);
                expected.push(f, id);
            } else {
                assert_eq!(actual.pop(), expected.pop());
            }
            assert_entries(&actual, &expected);
            operations += 1;
        }
        while !actual.entries.is_empty() {
            assert_eq!(actual.pop(), expected.pop());
            assert_entries(&actual, &expected);
            operations += 1;
        }
    }
    assert!(operations >= 196_608);
}
