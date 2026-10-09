// iRacing splits a long session into a new .ibt when the first file fills.
// The two files share one session, and the first piece of the later file is
// the rest of the lap the earlier file stopped in (PR 272).
//
// LMU never sets splitFiles: its garage-reset files keep the numbers
// segments() already wrote.

export function assignSessionLapNumbers(files, {splitFiles = false} = {}) {
  const out = [];
  for (let r = 0; r < files.length; r++) {
    const segs = files[r];
    let recOffset = 0;
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      let partial = !!seg.partial;
      let lapNumber = seg.lapNumber;
      if (splitFiles) {
        if (
          si === 0 &&
          r > 0 &&
          out.length &&
          seg.lapNumber <= out[out.length - 1].lapNumber
        ) {
          recOffset =
            out[out.length - 1].lapNumber - seg.lapNumber + 1;
        }
        if (r > 0 && si === 0) partial = true;
        if (r < files.length - 1 && si === segs.length - 1) partial = true;
        lapNumber = seg.lapNumber + recOffset;
        if (si === 0 && partial) lapNumber = Math.max(0, lapNumber - 1);
        if (
          r > 0 &&
          si === 0 &&
          out.length &&
          lapNumber === out[out.length - 1].lapNumber
        ) {
          continue;
        }
      }
      out.push({r, si, lapNumber, partial});
    }
  }
  return out;
}
