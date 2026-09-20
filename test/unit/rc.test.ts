// Unit tests for the pure RC model (run with `npm test`, Node's type stripping).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
    PHASE_CENTER,
    PHASE_IDLE,
    PHASE_REVIEW,
    PHASE_SWEEP,
    STALE_MS,
    calibrationAt,
    deflectionOf,
    isCalibrating,
    linkQualityVariant,
    rcSnapshot,
    rssiDbm,
    type Calibration,
    type RcCalibrationStateMsg,
    type RcInputs,
    type RcReference,
} from '../../src/rc/model.ts';

const REFERENCE: RcReference = JSON.parse(
    readFileSync(new URL('../../src/rc/rc_reference.json', import.meta.url), 'utf8'));
const NOW = 1_000_000;

// The A1's real transmitter: the linear stick (ch3) rests at 1004 and the angular one (ch1) at
// 987, 12 and 5 counts off the nominal 992 midpoint.
const LINEAR_REST = 1004;
const ANGULAR_REST = 987;

const filled = <T, >(value: T, overrides: Record<number, T> = {}) =>
    Array.from({ length: 16 }, (_unused, index) => overrides[index] ?? value);

const calibrationMsg = (overrides: Partial<Record<keyof Calibration, Record<number, number>>> = {}) => ({
    channel_min: filled(172, overrides.min),
    channel_mid: filled(992, overrides.mid),
    channel_max: filled(1811, overrides.max),
    channel_deadband: filled(30, overrides.deadband),
});

const calibrationState = (over: Partial<RcCalibrationStateMsg> = {}): RcCalibrationStateMsg => ({
    phase: PHASE_IDLE,
    samples: 0,
    progress: 0,
    teleop_inhibited: false,
    active: calibrationMsg(),
    measured: calibrationMsg(),
    channel_moved: filled(false),
    problems: [],
    message: '',
    ...over,
});

const inputs = (over: Partial<RcInputs> = {}): RcInputs => ({
    channels: null,
    channelsAt: null,
    link: null,
    linkAt: null,
    calibration: null,
    ...over,
});

test('lists every channel with its role, even before anything arrives', () => {
    const snapshot = rcSnapshot(inputs(), REFERENCE, NOW);

    assert.equal(snapshot.rows.length, 16);
    assert.equal(snapshot.everSeen, false);
    assert.equal(snapshot.stale, true);
    assert.equal(snapshot.rows[2].role, 'linear_x');
    assert.equal(snapshot.rows[0].role, 'angular_z');
    assert.equal(snapshot.rows[4].role, 'e_stop');
    assert.equal(snapshot.rows[5].role, null);
    // No frame is "unknown", not "centred": a bar at zero would claim the sticks are released.
    assert.equal(snapshot.rows[0].raw, null);
    assert.equal(snapshot.rows[0].deflection, null);
});

test('falls back to the nominal CRSF endpoints until a calibration arrives', () => {
    assert.deepEqual(calibrationAt(null, 0), { min: 172, mid: 992, max: 1811, deadband: 30 });
    // A short array is a malformed message, not a reason to read undefined.
    assert.deepEqual(
        calibrationAt({ channel_min: [1], channel_mid: [1], channel_max: [1], channel_deadband: [1] }, 5),
        { min: 172, mid: 992, max: 1811, deadband: 30 });
});

test('deflection is measured about the calibrated centre, not the nominal one', () => {
    const calibrated: Calibration = { min: 180, mid: LINEAR_REST, max: 1800, deadband: 11 };

    // The bug the global midpoint caused: a stick resting 12 counts off 992 read as deflected.
    assert.equal(deflectionOf(LINEAR_REST, calibrated), 0);
    assert.equal(deflectionOf(1800, calibrated), 1);
    assert.equal(deflectionOf(180, calibrated), -1);

    // Under the nominal calibration the same resting count is NOT zero-deflection once the
    // deadband is tight, which is exactly why the rover needed a 30-count one.
    assert.notEqual(deflectionOf(LINEAR_REST, { min: 172, mid: 992, max: 1811, deadband: 5 }), 0);
});

test('each half of the throw is normalised independently, like the rover does it', () => {
    // Asymmetric, as any trimmed transmitter is: 700 counts below centre, 900 above.
    const asymmetric: Calibration = { min: 300, mid: 1000, max: 1900, deadband: 0 };

    assert.equal(deflectionOf(1900, asymmetric), 1);
    assert.equal(deflectionOf(300, asymmetric), -1);
    assert.equal(deflectionOf(1000, asymmetric), 0);
    // Half the upper throw is half the output, not (1450-300)/1600.
    assert.ok(Math.abs(deflectionOf(1450, asymmetric) - 0.5) < 1e-9);
});

test('a value outside the calibrated range is clamped, never amplified', () => {
    const calibrated: Calibration = { min: 300, mid: 1000, max: 1700, deadband: 10 };

    assert.equal(deflectionOf(2047, calibrated), 1);
    assert.equal(deflectionOf(0, calibrated), -1);
});

test('a degenerate calibration reads as centred rather than dividing by nothing', () => {
    // The deadband swallows the whole half-throw; the rover's mapAxis returns 0.0 here too.
    assert.equal(deflectionOf(1500, { min: 900, mid: 1000, max: 1100, deadband: 200 }), 0);
    assert.equal(deflectionOf(1000, { min: 1000, mid: 1000, max: 1000, deadband: 0 }), 0);
});

test('reports staleness from the age of the last frame', () => {
    const channels = { channels: filled(992) };

    assert.equal(rcSnapshot(inputs({ channels, channelsAt: NOW }), REFERENCE, NOW).stale, false);
    assert.equal(
        rcSnapshot(inputs({ channels, channelsAt: NOW - STALE_MS - 1 }), REFERENCE, NOW).stale, true);
});

test('uses the active calibration for the live bars and the measured one while sweeping', () => {
    const channels = { channels: filled(992, { 2: LINEAR_REST, 0: ANGULAR_REST }) };
    const state = calibrationState({
        phase: PHASE_SWEEP,
        teleop_inhibited: true,
        active: calibrationMsg({ mid: { 2: LINEAR_REST, 0: ANGULAR_REST }, deadband: { 2: 11, 0: 9 } }),
        measured: calibrationMsg({ min: { 2: 180 }, max: { 2: 1795 }, mid: { 2: LINEAR_REST } }),
        channel_moved: filled(false, { 2: true }),
    });

    const snapshot = rcSnapshot(
        inputs({ channels, channelsAt: NOW, calibration: state }), REFERENCE, NOW);

    // The bar follows what the rover is mapping with right now...
    assert.equal(snapshot.rows[2].deflection, 0);
    assert.equal(snapshot.rows[0].deflection, 0);
    // ...while the range column follows the sweep, which is how you see a channel being swept.
    assert.deepEqual(snapshot.rows[2].measured, { min: 180, mid: LINEAR_REST, max: 1795, deadband: 30 });
    assert.equal(snapshot.rows[2].moved, true);
    assert.equal(snapshot.rows[5].moved, false);
    assert.equal(snapshot.teleopInhibited, true);
});

test('hides a previous measurement once the session is over', () => {
    const state = calibrationState({ phase: PHASE_IDLE, measured: calibrationMsg({ min: { 2: 180 } }) });

    const snapshot = rcSnapshot(inputs({ calibration: state }), REFERENCE, NOW);

    // At idle the measured arrays are whatever the last session left behind; showing them would
    // claim a calibration is in progress.
    assert.equal(snapshot.rows[2].measured, null);
});

test('carries the phase, progress and problems through for the wizard', () => {
    const state = calibrationState({
        phase: PHASE_REVIEW,
        samples: 137,
        progress: 1,
        problems: ['Channel 3: the 200-count deadband swallows one side of the throw.'],
        message: 'Measurement complete, with warnings.',
    });

    const snapshot = rcSnapshot(inputs({ calibration: state }), REFERENCE, NOW);

    assert.equal(snapshot.phase, PHASE_REVIEW);
    assert.equal(snapshot.samples, 137);
    assert.equal(snapshot.problems.length, 1);
    assert.equal(snapshot.message, 'Measurement complete, with warnings.');
});

test('knows when the calibration flow owns the sticks', () => {
    assert.equal(isCalibrating(PHASE_IDLE), false);
    assert.equal(isCalibrating(PHASE_CENTER), true);
    assert.equal(isCalibrating(PHASE_SWEEP), true);
    assert.equal(isCalibrating(PHASE_REVIEW), true);
});

test('colours link quality by the rover failsafe thresholds, not by taste', () => {
    // rover_crsf_teleop stops driving below 30 and only counts the link recovered at 50.
    assert.equal(linkQualityVariant(100), 'success');
    assert.equal(linkQualityVariant(50), 'success');
    assert.equal(linkQualityVariant(49), 'warning');
    assert.equal(linkQualityVariant(30), 'warning');
    assert.equal(linkQualityVariant(29), 'danger');
});

test('reports RSSI in dBm, which CRSF sends negated', () => {
    assert.equal(rssiDbm(65), -65);
});
