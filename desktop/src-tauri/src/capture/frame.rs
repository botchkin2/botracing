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

/// Two reads of the same span. None when they differ on every try, or a read fails.
pub fn stable<V: View>(view: &mut V, offset: usize, len: usize) -> Option<Vec<u8>> {
    for _ in 0..TRIES {
        let first = view.read(offset, len)?;
        let second = view.read(offset, len)?;
        if first == second {
            return Some(first);
        }
    }
    None
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

/// The player car, or None when the slot is empty or the two copies tore.
pub fn player<V: View>(view: &mut V, layout: &Layout) -> Option<Sample> {
    let idx = view.read(layout.offsets["playerVehicleIdx"], 1)?[0] as usize;
    let has = view.read(layout.offsets["playerHasVehicle"], 1)?[0];
    if has == 0 {
        return None;
    }
    let slot = layout.offsets["telemInfo"] + idx * layout.telem_size;
    let raw = stable(view, slot, layout.telem_size)?;
    let et = f64_at(&raw, layout.telem_et)?;
    Some(Sample { raw, et })
}

/// Scoring info plus the vehicle array, or None when the count is impossible or a copy tore.
pub fn scoring<V: View>(view: &mut V, layout: &Layout) -> Option<FieldSample> {
    let info = stable(view, layout.offsets["scoringInfo"], layout.scoring_size)?;
    let n = i32_at(&info, layout.num_vehicles)?;
    if n < 0 || n as usize > layout.max_vehicles {
        return None;
    }
    let count = n as usize;
    let vehicles = stable(
        view,
        layout.offsets["vehScoringInfo"],
        count * layout.veh_size,
    )?;
    let et = f64_at(&info, layout.scoring_et)?;
    Some(FieldSample { info, vehicles, count, et })
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
        let mut stable_mem = Mem { bytes: vec![0; lay.size], tear_at: None, reads: 0 };
        let slot = lay.offsets["telemInfo"];
        stable_mem.bytes[slot] = 7;
        let got = stable(&mut stable_mem, slot, lay.telem_size).unwrap();
        assert_eq!(got[0], 7);
        assert_eq!(stable_mem.reads, 2);

        let mut torn = Mem { bytes: vec![0; lay.size], tear_at: Some(slot), reads: 0 };
        assert!(stable(&mut torn, slot, lay.telem_size).is_none());
        assert_eq!(torn.reads, TRIES * 2);
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
}
