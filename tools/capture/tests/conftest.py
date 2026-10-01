import ctypes as C
from pathlib import Path

import pytest

import layout as layout_mod

FIXTURE = Path(__file__).with_name("fixture.hpp")


@pytest.fixture
def lay():
    return layout_mod.Layout(FIXTURE.read_text())


class Game:
    """Shared memory as the game would leave it, in a plain bytearray."""

    def __init__(self, lay, cars=3):
        self.lay = lay
        self.obj = lay.root()
        self.obj.generic.gameVersion = 14200
        s = self.obj.scoring.scoringInfo
        s.mTrackName = b"Road Atlanta"
        s.mSession = 10
        s.mNumVehicles = cars
        s.mPlayerName = b"Driver"
        for i in range(cars):
            v = self.obj.scoring.vehScoringInfo[i]
            v.mVehicleName = f"Car {i}".encode()
            v.mID = i
            v.mPlace = i + 1
            v.mLapDist = 100.0 * i
            v.mVehicleClass = b"GT3"
            v.mDriverName = f"Driver {i}".encode()
        t = self.obj.telemetry
        t.activeVehicles = cars
        t.playerHasVehicle = True
        t.playerVehicleIdx = 1
        for i in range(cars):
            t.telemInfo[i].mID = i
            t.telemInfo[i].mVehicleModel = b"Porsche 911 GT3 R" if i else b""
        p = t.telemInfo[1]
        p.mVehicleName = b"Car 1"
        p.mTrackName = b"Road Atlanta"
        p.mGear = 3
        p.mFrontTireCompoundName = b"Medium"
        p.mRearTireCompoundName = b"Soft"
        p.mLocalVel.z = 40.0
        for w in p.mWheel:
            w.mTemperature[:] = [350.0, 355.0, 352.0]
            w.mTireCarcassTemperature = 340.0
            w.mBrakeTemp = 600.0
        self.view = bytearray(bytes(self.obj))
        self.running = True

    def step(self, dt=0.01, scoring=False):
        p = self.obj.telemetry.telemInfo[1]
        p.mElapsedTime += dt
        if scoring:
            self.obj.scoring.scoringInfo.mCurrentET += 0.2
        self.view[:] = bytes(self.obj)


@pytest.fixture
def game(lay):
    return Game(lay)
