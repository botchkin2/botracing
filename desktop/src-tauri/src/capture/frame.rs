// One shared-memory frame, kept only when two copies match.
//
// LMU has no frame counter, and its lock is the game's lock: holding it
// stalls the game. The clock sits at the front of each struct, so a clock
// check alone can pass a half-written frame. Each frame is copied twice and
// kept only when both copies are identical.

use crate::capture::layout::Layout;

const TRIES: usize = 3;

pub trait View {
    fn read(&mut self, offset: usize, len: usize) -> Option<Vec<u8>>;
}

fn f64_at(raw: &[u8], offset: usize) -> Option<f64> {
    let bytes: [u8; 8] = raw.get(offset..offset + 8)?.try_into().ok()?;
    Some(f64::from_le_bytes(bytes))
}

fn i32_at(raw: &[u8], offset: usize) -> Option<i32> {
    let bytes: [u8; 4] = raw.get(offset..offset + 4)?.try_into().ok()?;
    Some(i32::from_le_bytes(bytes))
}

pub struct Sample {
    pub raw: Vec<u8>,
    pub et: f64,
}

pub struct FieldSample {
    pub info: Vec<u8>,
    pub vehicles: Vec<u8>,
    pub count: usize,
    pub et: f64,
}

/// The player car, or None when the slot is empty, out of range, or the copies tore.
///
/// The slot index is read inside the retry. A stale index past the telemetry
/// array would otherwise copy whatever bytes sit after it, and both copies
/// would agree.
pub fn player<V: View>(view: &mut V, layout: &Layout) -> Option<Sample> {
    for _ in 0..TRIES {
        let idx = view.read(layout.offsets["playerVehicleIdx"], 1)?[0] as usize;
        let has = view.read(layout.offsets["playerHasVehicle"], 1)?[0];
        if has == 0 || idx >= layout.max_vehicles {
            return None;
        }
        let slot = layout.offsets["telemInfo"] + idx * layout.telem_size;
        let first = view.read(slot, layout.telem_size)?;
        let second = view.read(slot, layout.telem_size)?;
        if first == second {
            let et = f64_at(&first, layout.telem_et)?;
            return Some(Sample { raw: first, et });
        }
    }
    None
}

/// Scoring info plus the vehicle array.
///
/// The four reads are info, vehicles, info, vehicles. Two separate stable
/// copies can pair info from one frame with vehicles from the next.
/// None when the count is impossible or the two copies of either span differ.
pub fn scoring<V: View>(view: &mut V, layout: &Layout) -> Option<FieldSample> {
    let info_at = layout.offsets["scoringInfo"];
    let veh_at = layout.offsets["vehScoringInfo"];
    for _ in 0..TRIES {
        let info = view.read(info_at, layout.scoring_size)?;
        let n = i32_at(&info, layout.num_vehicles)?;
        if n < 0 || n as usize > layout.max_vehicles {
            return None;
        }
        let count = n as usize;
        let span = count * layout.veh_size;
        let vehicles = view.read(veh_at, span)?;
        let info_again = view.read(info_at, layout.scoring_size)?;
        let vehicles_again = view.read(veh_at, span)?;
        if info == info_again && vehicles == vehicles_again {
            let et = f64_at(&info, layout.scoring_et)?;
            return Some(FieldSample { info, vehicles, count, et });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Mem {
        bytes: Vec<u8>,
        /// Flip this byte on every read, so the two copies never match.
        tear_at: Option<usize>,
        reads: usize,
    }

    impl View for Mem {
        fn read(&mut self, offset: usize, len: usize) -> Option<Vec<u8>> {
            let end = offset.checked_add(len)?;
            let mut out = self.bytes.get(offset..end)?.to_vec();
            self.reads += 1;
            // Flip on the first of each pair, so the two copies disagree.
            if let Some(at) = self.tear_at {
                if self.reads % 2 == 1 && offset <= at && at < end {
                    out[at - offset] ^= 0xff;
                }
            }
            Some(out)
        }
    }

    fn layout() -> Layout {
        Layout::parse(include_str!("../../../../tools/capture/tests/fixture.hpp")).unwrap()
    }

    #[test]
    fn a_torn_frame_is_dropped_and_a_stable_one_is_kept() {
        let lay = layout();
        let slot = lay.offsets["telemInfo"];
        // Per try: vehicle index, has-vehicle, then the slot twice.
        let mut stable_mem = Mem { bytes: vec![0; lay.size], tear_at: None, reads: 0 };
        stable_mem.bytes[lay.offsets["playerHasVehicle"]] = 1;
        stable_mem.bytes[slot] = 7;
        let got = player(&mut stable_mem, &lay).unwrap();
        assert_eq!(got.raw[0], 7);
        assert_eq!(stable_mem.reads, 4);

        let mut torn = Mem { bytes: vec![0; lay.size], tear_at: Some(slot), reads: 0 };
        torn.bytes[lay.offsets["playerHasVehicle"]] = 1;
        assert!(player(&mut torn, &lay).is_none());
        assert_eq!(torn.reads, TRIES * 4);
    }

    #[test]
    fn the_player_frame_is_the_slot_twice() {
        let lay = layout();
        let mut mem = Mem { bytes: vec![0; lay.size], tear_at: None, reads: 0 };
        mem.bytes[lay.offsets["playerHasVehicle"]] = 1;
        // mElapsedTime is a double at telem_et inside the slot.
        let et = 12.5_f64.to_le_bytes();
        let at = lay.offsets["telemInfo"] + lay.telem_et;
        mem.bytes[at..at + 8].copy_from_slice(&et);
        let sample = player(&mut mem, &lay).unwrap();
        assert_eq!(sample.et, 12.5);
        assert_eq!(sample.raw.len(), lay.telem_size);

        mem.bytes[lay.offsets["playerVehicleIdx"]] = 255;
        assert!(player(&mut mem, &lay).is_none());
    }

    #[test]
    fn an_impossible_vehicle_count_is_dropped() {
        let lay = layout();
        let mut mem = Mem { bytes: vec![0; lay.size], tear_at: None, reads: 0 };
        let at = lay.offsets["scoringInfo"] + lay.num_vehicles;
        mem.bytes[at..at + 4].copy_from_slice(&99_i32.to_le_bytes());
        assert!(scoring(&mut mem, &lay).is_none());

        mem.bytes[at..at + 4].copy_from_slice(&1_i32.to_le_bytes());
        let got = scoring(&mut mem, &lay).unwrap();
        assert_eq!(got.count, 1);
        assert_eq!(got.info.len(), lay.scoring_size);
        assert_eq!(got.vehicles.len(), lay.veh_size);
        assert_eq!(got.et, 0.0);
    }

    /// Vehicles change once the info span has been read twice. Two separate
    /// stable copies would still succeed and pair the old info with the new
    /// vehicles. The interleaved read must drop it.
    struct Drift {
        bytes: Vec<u8>,
        info_at: usize,
        veh_at: usize,
        info_reads: u32,
    }

    impl View for Drift {
        fn read(&mut self, offset: usize, len: usize) -> Option<Vec<u8>> {
            let end = offset.checked_add(len)?;
            let out = self.bytes.get(offset..end)?.to_vec();
            if offset == self.info_at {
                self.info_reads += 1;
                if self.info_reads % 2 == 0 {
                    self.bytes[self.veh_at] = self.bytes[self.veh_at].wrapping_add(1);
                }
            }
            Some(out)
        }
    }

    #[test]
    fn scoring_does_not_pair_info_from_one_frame_with_vehicles_from_the_next() {
        let lay = layout();
        let mut drift = Drift {
            bytes: vec![0; lay.size],
            info_at: lay.offsets["scoringInfo"],
            veh_at: lay.offsets["vehScoringInfo"],
            info_reads: 0,
        };
        let at = drift.info_at + lay.num_vehicles;
        drift.bytes[at..at + 4].copy_from_slice(&1_i32.to_le_bytes());
        assert!(scoring(&mut drift, &lay).is_none());
    }
}
