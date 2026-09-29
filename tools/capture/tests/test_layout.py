import ctypes as C

import pytest

import layout as layout_mod


def test_fixture_layout(lay):
    wheel = lay.struct("TelemWheelV01")
    # pack(4): 8 + 24 + 8 + 4 + 18 = 62, padded to 64.
    assert C.sizeof(wheel) == 64
    assert C.sizeof(lay.struct("TelemVect3")) == 24
    assert lay.telem.mWheel.offset % 4 == 0
    # enum class : uint8_t is one byte; two bools on one line are two fields.
    names = [n for n, _ in lay.telem._fields_]
    assert names[-4:] == ["mVehicleClass", "mABSActive", "mTCActive", "mWheel"]
    assert C.sizeof(dict(lay.telem._fields_)["mVehicleClass"]) == 1
    # Pointers are 8 bytes; the enum-sized array resolves to SME_MAX = 2.
    assert C.sizeof(lay.struct("SharedMemoryGeneric")) == 2 * 4 + 4 + 4
    assert lay.max_vehicles == 8
    # Three one-byte fields, then pack(4) aligns the array to 4.
    assert lay.offsets["telemInfo"] == lay.root.telemetry.offset + 4


def test_default_packing_outside_pragma(lay):
    # SharedMemoryScoringData is after #pragma pack(pop): size_t aligns to 8.
    sd = lay.struct("SharedMemoryScoringData")
    assert sd.scoringStreamSize.offset % 8 == 0


def test_unknown_type_raises():
    with pytest.raises(layout_mod.LayoutError, match="unknown type"):
        layout_mod.Layout(
            "struct TelemInfoV01 { mystery_t mX; };"
            "struct SharedMemoryObjectOut { TelemInfoV01 t; };"
        )


def test_hash_follows_the_text(lay):
    other = layout_mod.Layout(open(__file__.replace("test_layout.py", "fixture.hpp")).read() + "\n")
    assert other.hash != lay.hash


@pytest.mark.skipif(
    not (layout_mod.DEFAULT_HEADER_DIR / "InternalsPlugin.hpp").exists(),
    reason="LMU is not installed here",
)
def test_real_header_parses():
    L = layout_mod.load()
    for name in ("mElapsedTime", "mTrackName", "mVehicleName", "mLocalVel", "mGear", "mWheel"):
        assert hasattr(L.telem, name)
    assert L.max_vehicles == 104
