// LMU shared-memory capture, ported from tools/capture. The game's header is
// read at run time; this module never stores S397's struct offsets.
pub mod columns;
pub mod frame;
pub mod irsdk;
pub mod layout;
pub mod probe;
pub mod recorder;
pub mod sanity;
pub mod store;
pub mod runner;
#[cfg(windows)]
pub mod win;
#[cfg(all(test, windows))]
mod soak;
