// Unit tests for the pure LED model (run with `npm test`, Node's type stripping).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
    decodeRgba,
    ledColor,
    ledSnapshot,
    panelRows,
    type LedInputs,
    type LedLayerStateMsg,
    type LedReference,
    type LedStateMsg,
} from '../../src/leds/model.ts';

const REFERENCE: LedReference = JSON.parse(
    readFileSync(new URL('../../src/leds/led_reference.json', import.meta.url), 'utf8'));
const NOW = 1_000_000;

const idle = (priority: number): LedLayerStateMsg =>
    ({ priority, active: false, id: 0, name: '', param: '', repeating: false, progress: 0, queued: 0 });

const segment = (name: string, channel: number, playing: Record<number, Partial<LedLayerStateMsg>> = {}) => ({
    name,
    channel,
    layers: [0, 1, 2, 3].map(priority => (playing[priority]
        ? { ...idle(priority), active: true, ...playing[priority] }
        : idle(priority))),
});

const inputs = (overrides: Partial<LedInputs> = {}): LedInputs => ({
    catalog: null,
    state: null,
    stateAt: null,
    frames: new Map([[1, null], [2, null]]),
    brightness: null,
    ...overrides,
});

const catalog = [...Array(11).keys()].map(id => ({ id, name: `LOADED_${id}`, priority: 3 }));

test('lists the full reference table and marks what the robot has not loaded', () => {
    assert.ok(ledSnapshot(inputs(), REFERENCE, NOW).animations.every(row => row.configured === null));

    const rows = ledSnapshot(inputs({ catalog }), REFERENCE, NOW).animations;
    assert.equal(rows.length, 18);
    assert.deepEqual(rows.filter(row => !row.configured).map(row => row.id), [11, 12, 13, 14, 15, 16, 17]);
    // The loaded catalog wins over the reference for name and priority.
    assert.equal(rows[1].name, 'LOADED_1');
    assert.equal(rows[17].name, 'FLOOD_LIGHT');
    assert.equal(rows[17].layer, 'STATE');
});

test('reports the highest-priority playing layer on top', () => {
    const state: LedStateMsg = {
        segments: [
            segment('front_1', 1, { 1: { id: 9, name: 'CHARGER_INSERTED', progress: 0.4, queued: 2 }, 3: { id: 1, name: 'READY', repeating: true } }),
            segment('rear_1', 2, { 3: { id: 1, name: 'READY', repeating: true } }),
        ],
    };
    const snapshot = ledSnapshot(inputs({ state, stateAt: NOW }), REFERENCE, NOW);

    assert.equal(snapshot.stale, false);
    assert.equal(snapshot.top?.name, 'CHARGER_INSERTED');
    assert.equal(snapshot.top?.layer, 'ALERT');
    assert.equal(snapshot.top?.queued, 2);
    assert.deepEqual(snapshot.layers[3].animations[0].segments, ['front_1', 'rear_1']);
    assert.equal(snapshot.layers[0].animations.length, 0);
    assert.deepEqual(snapshot.animations.filter(row => row.active).map(row => row.id), [1, 9]);
    assert.deepEqual(snapshot.segments, [{ name: 'front_1', channel: 1 }, { name: 'rear_1', channel: 2 }]);
});

test('drops state and frames that stopped arriving', () => {
    const state: LedStateMsg = { segments: [segment('front_1', 1, { 3: { id: 0, name: 'E_STOP' } })] };
    const frames = new Map([[1, { leds: decodeRgba({ data: Uint8Array.from([255, 0, 0, 255]) }), rows: 1, at: NOW }], [2, null]]);
    const snapshot = ledSnapshot(inputs({ state, stateAt: NOW, frames }), REFERENCE, NOW + 2500);

    assert.equal(snapshot.stale, true);
    assert.equal(snapshot.top, null);
    assert.ok(snapshot.animations.every(row => !row.active));
    assert.equal(snapshot.panels[0].leds, null);
    assert.equal(snapshot.updatedAt, NOW);
});

test('keeps fresh frames per channel', () => {
    const frames = new Map([
        [1, { leds: decodeRgba({ data: Uint8Array.from([1, 2, 3, 4]) }), rows: 1, at: NOW }],
        [2, { leds: decodeRgba({ data: Uint8Array.from([5, 6, 7, 8, 9, 10, 11, 12]) }), rows: 2, at: NOW - 5000 }],
    ]);
    const snapshot = ledSnapshot(inputs({ frames }), REFERENCE, NOW + 100);
    assert.deepEqual(snapshot.panels, [
        { channel: 1, leds: [[1, 2, 3, 4]], rows: 1 },
        { channel: 2, leds: null, rows: 2 },
    ]);
});

test('draws a straight strip as one row, LED 0 on the left', () => {
    const leds = [...Array(4).keys()].map(i => [i, 0, 0, 255] as [number, number, number, number]);
    assert.deepEqual(panelRows(leds, 1).map(row => row.map(item => item.index)), [[0, 1, 2, 3]]);
});

test('draws the front serpentine panel as 0…19 over 39…20', () => {
    const leds = [...Array(40).keys()].map(i => [i, 0, 0, 255] as [number, number, number, number]);
    const rows = panelRows(leds, 2, 'left').map(row => row.map(item => item.index));
    assert.deepEqual(rows[0], [...Array(20).keys()]);
    assert.deepEqual(rows[1], [...Array(20).keys()].map(i => 39 - i));
});

test('draws the rear serpentine panel as 19…0 over 20…39', () => {
    const leds = [...Array(40).keys()].map(i => [i, 0, 0, 255] as [number, number, number, number]);
    const rows = panelRows(leds, 2, 'right').map(row => row.map(item => item.index));
    assert.deepEqual(rows[0], [...Array(20).keys()].reverse());
    assert.deepEqual(rows[1], [...Array(20).keys()].map(i => 20 + i));
    assert.deepEqual(panelRows(leds, 2, 'right')[0][0].led, [19, 0, 0, 255]);
});

test('decodes rgba8 frames into one rgba tuple per LED', () => {
    const bytes = [1, 2, 3, 4, 5, 6, 7, 8];
    assert.deepEqual(decodeRgba({ data: Uint8Array.from(bytes) }), [[1, 2, 3, 4], [5, 6, 7, 8]]);
    assert.deepEqual(decodeRgba({ data: bytes }), [[1, 2, 3, 4], [5, 6, 7, 8]]);
    assert.deepEqual(decodeRgba({}), []);
});

test('scales the LED colour by its brightness', () => {
    assert.equal(ledColor([255, 128, 0, 255]), 'rgb(255 128 0)');
    assert.equal(ledColor([255, 128, 0, 0]), 'rgb(0 0 0)');
});

test('scales the LED colour by the global brightness', () => {
    assert.equal(ledColor([255, 128, 0, 255], 0.5), 'rgb(128 64 0)');
    assert.equal(ledColor([255, 128, 0, 255], 0), 'rgb(0 0 0)');
    assert.equal(ledColor([255, 128, 0, 255], 2), 'rgb(255 128 0)');
});

test('passes the reported brightness through, null until known', () => {
    assert.equal(ledSnapshot(inputs(), REFERENCE, NOW).brightness, null);
    assert.equal(ledSnapshot(inputs({ brightness: 0.25 }), REFERENCE, NOW).brightness, 0.25);
});
