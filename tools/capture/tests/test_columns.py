import columns


def test_columns_names_and_values(lay):
    t = lay.telem()
    t.mElapsedTime = 12.5
    t.mPos.x = 7.0
    t.mOri[2].y = -1.0
    t.mWheel[2].mTemperature[1] = 350.0
    cols = columns.columns(bytes(t) * 3, lay.telem)
    assert list(cols["mElapsedTime"]) == [12.5] * 3
    assert cols["mPos_x"][0] == 7.0
    assert cols["mOri_2_y"][0] == -1.0
    assert cols["rl_mTemperature_1"][0] == 350.0
    assert "fl_mBrakeTemp" in cols
    # Text and filler stay out of the rows.
    assert not any(k.startswith(("mVehicleName", "mTrackName")) or "mExpansion" in k for k in cols)


def test_dtype_matches_ctypes_size(lay):
    for t in (lay.telem, lay.vehicle, lay.scoring):
        assert columns.dtype_of(t).itemsize == __import__("ctypes").sizeof(t)
