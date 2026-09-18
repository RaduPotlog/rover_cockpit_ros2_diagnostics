// Unit tests for the pure networking model (run with `npm test`, Node's type stripping).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    NetworkHistory,
    deviceState,
    historyStats,
    interfaceOf,
    lightState,
    parsePingRtt,
    summarize,
    type DeviceConfig,
    type ProbeResult,
} from '../../src/networking/model.ts';

const result = (reachable: boolean, latency_ms: number | null = reachable ? 1.2 : null): ProbeResult => ({
    reachable,
    latency_ms,
    checked_at: '2026-01-01T00:00:00.000Z',
    error: reachable ? null : 'No ICMP response',
});

test('parses the round-trip time from ping output', () => {
    assert.equal(parsePingRtt('64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=0.412 ms'), 0.412);
    assert.equal(parsePingRtt('64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time<1 ms'), 1);
    assert.equal(parsePingRtt('1 packets transmitted, 0 received, 100% packet loss'), null);
});

test('device statuses and history limit', () => {
    const devices: DeviceConfig[] = [{
        id: 'router',
        name: 'Router',
        role: 'router',
        interfaces: [{ name: 'A', address: '10.0.0.1' }, { name: 'B', address: '10.0.0.2' }],
    }];
    const history = new NetworkHistory(devices);
    assert.deepEqual(history.addresses(), ['10.0.0.1', '10.0.0.2']);
    assert.equal(history.snapshot()[0].status, 'unknown');

    history.record([result(true), result(false)]);
    const [snapshot] = history.snapshot();
    assert.equal(snapshot.status, 'partial');
    assert.equal(snapshot.interfaces[0].status, 'online');
    assert.equal(snapshot.interfaces[0].latency_ms, 1.2);
    assert.equal(snapshot.interfaces[1].status, 'offline');
    assert.equal(snapshot.interfaces[1].error, 'No ICMP response');

    for (let i = 0; i < 65; i += 1) history.record([result(true), result(false)]);
    assert.equal(history.snapshot()[0].interfaces[0].history.length, 60);
});

test('device roll-up covers every state', () => {
    assert.equal(deviceState(['online', 'online']), 'online');
    assert.equal(deviceState(['online', 'offline']), 'partial');
    assert.equal(deviceState(['offline', 'offline']), 'offline');
    assert.equal(deviceState(['online', 'unknown']), 'unknown');
});

test('snapshot does not expose internal state', () => {
    const devices: DeviceConfig[] = [{ id: 'd', name: 'D', role: '', interfaces: [{ name: 'A', address: '10.0.0.1' }] }];
    const history = new NetworkHistory(devices);
    history.record([result(true)]);
    history.snapshot()[0].interfaces[0].history.push(result(false));
    assert.equal(history.snapshot()[0].interfaces[0].history.length, 1);
    assert.equal((devices[0] as unknown as { status?: string }).status, undefined);
});

test('summary counts devices per state', () => {
    const devices: DeviceConfig[] = [
        { id: 'up', name: 'Up', role: '', interfaces: [{ name: 'A', address: '10.0.0.1' }] },
        { id: 'down', name: 'Down', role: '', interfaces: [{ name: 'A', address: '10.0.0.2' }] },
    ];
    const history = new NetworkHistory(devices);
    history.record([result(true), result(false)]);
    assert.deepEqual(summarize(history.snapshot()), { online: 1, partial: 0, offline: 1, unknown: 0 });
});

test('history stats report loss and average latency', () => {
    assert.deepEqual(historyStats([]), { probes: 0, lossPercent: 0, averageMs: null });
    assert.deepEqual(historyStats([result(true, 1), result(true, 2), result(false), result(true, 4)]),
                     { probes: 4, lossPercent: 25, averageMs: 2.33 });
});

test('link lights mirror the far end of unmonitored ports', () => {
    const devices: DeviceConfig[] = [{ id: 'r', name: 'R', role: '', interfaces: [{ name: 'WAN', address: '10.0.0.1' }] }];
    const history = new NetworkHistory(devices);
    history.record([result(false)]);
    const byId = new Map(history.snapshot().map(device => [device.id, device]));
    const node = { id: 'r', name: 'R', model: 'M', kind: 'router', x: 0, y: 0, device: 'r' };
    const wifi = { id: 'wifi', name: 'W', model: 'M', kind: 'wireless-router', x: 0, y: 0 };

    const own = interfaceOf(byId, node, { node: 'r', interface: 'WAN' });
    const far = interfaceOf(byId, wifi, { node: 'wifi' });
    assert.equal(own?.address, '10.0.0.1');
    assert.equal(far, null);
    assert.equal(lightState(own, far), 'offline');
    assert.equal(lightState(far, own), 'offline');
    assert.equal(lightState(null, null), 'unmonitored');
});
