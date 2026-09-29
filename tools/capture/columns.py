"""Raw struct bytes to named numeric columns, decoded a whole chunk at a time.

The recorder keeps each sample as the struct's raw bytes, which costs one copy
per frame. Decoding happens once per chunk with numpy, so the per-frame work
stays tiny next to the game.
"""

import ctypes as C

import numpy as np

WHEELS = ("fl", "fr", "rl", "rr")
# Filler and ids the analysis never reads.
SKIP_PREFIXES = ("mExpansion", "mUnused", "mUpgradePack", "mPhysicsToGraphicsOffset")

_SCALAR = {
    C.c_double: "<f8",
    C.c_float: "<f4",
    C.c_bool: "?",
    C.c_int8: "i1",
    C.c_uint8: "u1",
    C.c_int16: "<i2",
    C.c_uint16: "<u2",
    C.c_int32: "<i4",
    C.c_uint32: "<u4",
    C.c_int64: "<i8",
    C.c_uint64: "<u8",
    C.c_void_p: "<u8",
    C.c_char: "S1",
}


def dtype_of(ctype):
    """A numpy dtype with the same size and offsets as a ctypes type."""
    if ctype in _SCALAR:
        return np.dtype(_SCALAR[ctype])
    # ctypes' own aliases (c_long is c_int32 on Windows, and so on).
    for known, code in _SCALAR.items():
        if ctype is known or (
            issubclass(ctype, C._SimpleCData) and ctype._type_ == known._type_
        ):
            return np.dtype(code)
    if issubclass(ctype, C.Array):
        if ctype._type_ is C.c_char:
            return np.dtype(f"S{ctype._length_}")
        return np.dtype((dtype_of(ctype._type_), (ctype._length_,)))
    if issubclass(ctype, C.Structure):
        names, formats, offsets = [], [], []
        for name, field_type in ctype._fields_:
            names.append(name)
            formats.append(dtype_of(field_type))
            offsets.append(getattr(ctype, name).offset)
        return np.dtype(
            {"names": names, "formats": formats, "offsets": offsets, "itemsize": C.sizeof(ctype)}
        )
    raise TypeError(f"no dtype for {ctype}")


def _flatten(prefix, arr, out):
    if arr.ndim > 1:
        # A sub-array: the four wheels by name (fl_mPressure), anything else by index.
        n = arr.shape[1]
        for i in range(n):
            child = WHEELS[i] if prefix == "mWheel" and n == 4 else f"{prefix}_{i}"
            _flatten(child, arr[:, i], out)
        return
    dt = arr.dtype
    if dt.names:
        for name in dt.names:
            if not name.startswith(SKIP_PREFIXES):
                _flatten(f"{prefix}_{name}" if prefix else name, arr[name], out)
        return
    if dt.kind not in "SV":  # names and filler live in meta.json, not in every row
        out[prefix] = arr


def columns(raw, ctype, text_fields=()):
    """{column: 1-D array} from concatenated raw structs of one ctypes type.

    Text is left out except the top-level char fields named in text_fields,
    decoded to strings (Parquet dictionary-encodes the repeats).
    """
    arr = np.frombuffer(raw, dtype=dtype_of(ctype))
    out = {}
    _flatten("", arr, out)
    for name in (n for n in text_fields if n in arr.dtype.names):
        out[name] = np.array(
            [decode_text(bytes(v)) for v in arr[name]], dtype=object
        )
    return out


def decode_text(raw):
    """A NUL-terminated char buffer as text.

    LMU writes UTF-8 (2026-09-29 Daytona capture: c3 b3 for an accented o, c3 81
    for a capital A-acute); latin-1 is the fallback for bytes that are not valid
    UTF-8, so a garbled layout still shows its bytes.
    """
    body = raw.split(b"\0", 1)[0]
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("latin-1")


def text(field):
    """A fixed char field as text."""
    return decode_text(bytes(field))
