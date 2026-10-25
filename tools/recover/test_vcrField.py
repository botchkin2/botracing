"""Tests for vcrField.py: the pure parts (matching a replay car to its XML driver, the places, the laps, the XML
reader), on numbers from the 2026-10-21/22 Sebring qualifyings' dry runs (no names).
Run: uv run --with numpy --with pytest pytest -q   (from tools/recover)"""
import numpy as np

import vcrField as v


def car(*cross):
    x = np.array(cross, float)
    return {'cross': x, 'cross_x': x}


def driver(ends, nums=None, best=-1.0):
    return {'ends': list(ends), 'nums': nums or list(range(2, 2 + len(ends))), 'best': best, 'laps': []}


def test_two_cars_running_together_are_told_apart_by_the_extra_laps():
    # Q16: cars 3 and 7 and drivers A (5 laps) and B (3 laps) cross the line together to a tenth on laps 2 and 3
    cars = {3: car(23.8, 193.9, 318.9), 7: car(25.6, 193.9, 318.9, 443.1, 566.1, 690.7), 8: car(85.0, 259.7, 388.5)}
    drivers = [
        driver([63.5, 193.8, 318.9, 443.1, 566.2]),
        driver([63.2, 193.9, 319.0]),
        driver([125.2, 259.7]),
        driver([]),
    ]
    assign, _, how = v.match_cars(cars, drivers)
    assert assign == {7: 0, 3: 1, 8: 2}
    assert how[7] == how[3] == 'among the rest, by lap ends shared'
    assert how[8] == 'one lap end only'


def test_a_car_with_one_clean_pair_is_taken_and_one_with_none_is_not():
    # Q17: three cars each share exactly one lap end with exactly one driver (their pit-lane crossings are missing)
    cars = {1: car(28.2, 177.5), 18: car(276.0, 478.0, 595.0), 20: car(89.0, 260.0, 386.1), 22: car(96.8)}
    drivers = [
        driver([62.8, 177.6]),
        driver([295.2, 340.3, 478.1]),
        driver([128.9, 260.1]),
        driver([95.5, 116.0, 137.0, 157.2]),
        driver([]),
    ]
    assign, _, how = v.match_cars(cars, drivers)
    assert assign == {1: 0, 18: 1, 20: 2}
    assert all(how[d] == 'one lap end only' for d in assign)
    assert 22 not in assign


def test_one_shared_end_is_not_enough_when_it_could_be_either_car():
    cars = {1: car(100.0, 250.0), 2: car(100.05, 400.0)}
    drivers = [driver([100.0, 500.0]), driver([600.0, 700.0])]
    assign, _, _ = v.match_cars(cars, drivers)
    assert assign == {}


def test_a_clear_match_is_taken_first_and_called_clear():
    cars = {1: car(60.0, 120.0, 180.0, 240.0), 2: car(70.0, 130.0, 190.0, 250.0)}
    drivers = [driver([60.0, 120.0, 180.0, 240.0]), driver([70.0, 130.0, 190.0, 250.0])]
    assign, scores, how = v.match_cars(cars, drivers)
    assert assign == {1: 0, 2: 1}
    assert how == {1: 'clear', 2: 'clear'}
    assert scores[(1, 0)] == 1.0


def test_a_race_ranks_by_progress_and_a_qualifying_by_best_lap():
    prog = np.array([[100.0, 100.0], [300.0, 300.0], [200.0, 200.0]])  # car 1 furthest round the track
    bestnow = np.array([[1e9, 120.0], [1e9, 125.0], [130.0, 130.0]])
    race = v.rank_places('race', prog, None)
    assert race[:, 1].tolist() == [3, 1, 2]
    qual = v.rank_places('qualify', prog, bestnow)
    # at the last tick: car 0 has the best lap (120), then car 1 (125), then car 2 (130), whatever the progress
    assert qual[:, 1].tolist() == [1, 2, 3]
    # at the first tick only car 2 has a time: it leads, the two without a time follow by progress
    assert qual[:, 0].tolist() == [3, 2, 1]


def test_best_laps_so_far_skips_untimed_laps_and_unmatched_cars():
    ticks = np.arange(0.0, 400.0, 100.0)
    drivers = [{'ends': [150.0, 250.0, 350.0], 'laps': [120.0, -1.0, 118.0]}]
    best = v.best_laps_so_far([5, 6], {5: 0}, drivers, ticks)
    assert best[0].tolist() == [1e9, 1e9, 120.0, 120.0]
    assert best[1].tolist() == [1e9] * 4


def test_a_qualifying_counts_the_out_lap_it_has_no_row_for():
    ticks = np.array([0.0, 100.0, 200.0, 300.0])
    # rows number 2, 3: the out lap ended before the replay started, so one lap is done at tick 0
    assert v.laps_completed([2, 3], [150.0, 250.0], ticks).tolist() == [1, 1, 2, 3]
    # a race's first row is lap 1: nothing done until its first end
    assert v.laps_completed([1, 2], [150.0, 250.0], ticks).tolist() == [0, 0, 1, 2]
    assert v.laps_completed([], [], ticks).tolist() == [0, 0, 0, 0]


def test_the_xml_gives_the_kind_and_the_lap_numbers(tmp_path):
    xml = (
        '<rFactorXML><RaceResults><Qualify><Driver><Name>X</Name><CarClass>GT3</CarClass><CarType>T</CarType>'
        '<BestLapTime>120.5</BestLapTime><Position>2</Position><ClassPosition>1</ClassPosition><Laps>4</Laps>'
        '<Lap num="2" p="1" et="80.5">114.2</Lap><Lap num="3" p="1" et="200.0">--.----</Lap>'
        '<Lap num="4" p="1" et="320.5">120.5</Lap></Driver></Qualify></RaceResults></rFactorXML>'
    )
    p = tmp_path / 'q.xml'
    p.write_text(xml)
    assert v.read_kind(str(p)) == 'qualify'
    (d,) = v.read_xml(str(p))
    assert d['nums'] == [2, 3, 4]
    assert d['ends'] == [80.5, 200.0, 320.5]
    assert d['laps'] == [114.2, -1.0, 120.5]
    p.write_text(xml.replace('Qualify', 'Race'))
    assert v.read_kind(str(p)) == 'race'
    p.write_text(xml.replace('Qualify', 'Practice1'))
    assert v.read_kind(str(p)) == 'practice'
