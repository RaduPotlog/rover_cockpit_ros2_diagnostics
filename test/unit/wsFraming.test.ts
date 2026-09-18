// Unit tests for the WebSocket client framing (run with `npm test`, Node's type stripping).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    FrameDecoder,
    OPCODE,
    buildHandshake,
    encodeClose,
    encodeFrame,
    parseHandshakeResponse,
} from '../../src/roslib/wsFraming.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

// A server frame (unmasked), as foxglove_bridge sends them.
const serverFrame = (opcode: number, payload: Uint8Array, fin = true) => {
    const length = payload.length;
    const extended = length < 126 ? 0 : length < 0x10000 ? 2 : 8;
    const frame = new Uint8Array(2 + extended + length);
    frame[0] = (fin ? 0x80 : 0) | opcode;
    if (extended === 0) frame[1] = length;
    else if (extended === 2) { frame[1] = 126; frame[2] = length >>> 8; frame[3] = length & 0xff }
    else { frame[1] = 127; new DataView(frame.buffer).setBigUint64(2, BigInt(length)) }
    frame.set(payload, 2 + extended);
    return frame;
};

const concat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length }
    return out;
};

test('builds the upgrade request with the foxglove subprotocols', () => {
    const request = buildHandshake('127.0.0.1:8765', '/', ['foxglove.sdk.v1', 'foxglove.websocket.v1'], 'a2V5');
    assert.ok(request.startsWith('GET / HTTP/1.1\r\nHost: 127.0.0.1:8765\r\n'));
    assert.match(request, /\r\nUpgrade: websocket\r\n/);
    assert.match(request, /\r\nSec-WebSocket-Key: a2V5\r\n/);
    assert.match(request, /\r\nSec-WebSocket-Protocol: foxglove.sdk.v1, foxglove.websocket.v1\r\n/);
    assert.ok(request.endsWith('\r\n\r\n'));
});

test('parses a handshake response split across chunks and keeps the frame bytes after it', () => {
    const header = 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: x\r\nsec-websocket-protocol: foxglove.sdk.v1\r\n\r\n';
    const first = serverFrame(OPCODE.TEXT, bytes('{"op":"serverInfo"}'));
    const all = concat(bytes(header), first);

    assert.equal(parseHandshakeResponse(all.subarray(0, 40)), null);
    assert.equal(parseHandshakeResponse(bytes(header).subarray(0, header.length - 1)), null);
    const response = parseHandshakeResponse(all);
    assert.equal(response?.status, 101);
    assert.equal(response?.protocol, 'foxglove.sdk.v1');
    assert.deepEqual(response?.rest, first);
});

test('reports a refused upgrade', () => {
    assert.equal(parseHandshakeResponse(bytes('HTTP/1.1 400 Bad Request\r\n\r\n'))?.status, 400);
});

test('decodes text and binary frames of every length encoding, byte by byte', () => {
    const small = new Uint8Array(10).map((_, i) => i);
    const medium = new Uint8Array(300).map((_, i) => i & 0xff);
    const large = new Uint8Array(70000).map((_, i) => (i * 7) & 0xff);
    const stream = concat(
        serverFrame(OPCODE.TEXT, bytes('héllo')),
        serverFrame(OPCODE.BINARY, small),
        serverFrame(OPCODE.BINARY, medium),
        serverFrame(OPCODE.BINARY, large),
    );

    const decoder = new FrameDecoder();
    const messages = [];
    // Worst case chunking: one byte at a time for the first frames, then the rest at once.
    for (let i = 0; i < 400; i++) messages.push(...decoder.push(stream.subarray(i, i + 1)));
    messages.push(...decoder.push(stream.subarray(400)));

    assert.deepEqual(messages.map(m => m.type), ['text', 'binary', 'binary', 'binary']);
    assert.deepEqual(messages[0], { type: 'text', data: 'héllo' });
    assert.deepEqual((messages[1] as { data: Uint8Array }).data, small);
    assert.deepEqual((messages[2] as { data: Uint8Array }).data, medium);
    assert.deepEqual((messages[3] as { data: Uint8Array }).data, large);
});

test('reassembles fragmented messages around an interleaved ping', () => {
    const decoder = new FrameDecoder();
    const messages = decoder.push(concat(
        serverFrame(OPCODE.BINARY, Uint8Array.from([1, 2]), false),
        serverFrame(OPCODE.PING, bytes('hi')),
        serverFrame(OPCODE.CONTINUATION, Uint8Array.from([3]), false),
        serverFrame(OPCODE.CONTINUATION, Uint8Array.from([4, 5])),
    ));
    assert.deepEqual(messages, [
        { type: 'ping', data: bytes('hi') },
        { type: 'binary', data: Uint8Array.from([1, 2, 3, 4, 5]) },
    ]);
});

test('decodes close frames with and without a status code', () => {
    const decoder = new FrameDecoder();
    const withCode = concat(Uint8Array.from([0x03, 0xe9]), bytes('going away'));
    assert.deepEqual(decoder.push(serverFrame(OPCODE.CLOSE, withCode)), [{ type: 'close', code: 1001, reason: 'going away' }]);
    assert.deepEqual(decoder.push(serverFrame(OPCODE.CLOSE, new Uint8Array(0))), [{ type: 'close', code: 1005, reason: '' }]);
});

test('encodes masked client frames that decode back to the payload', () => {
    const mask = Uint8Array.from([0x12, 0x34, 0x56, 0x78]);
    for (const size of [0, 5, 125, 126, 300, 65535, 65536, 70000]) {
        const payload = new Uint8Array(size).map((_, i) => (i * 13) & 0xff);
        const frame = encodeFrame(OPCODE.BINARY, payload, mask);
        assert.equal(frame[0], 0x80 | OPCODE.BINARY);
        assert.equal(frame[1] & 0x80, 0x80, 'client frames are masked');
        const headerLength = size < 126 ? 2 : size < 0x10000 ? 4 : 10;
        assert.equal(frame.length, headerLength + 4 + size);
        assert.deepEqual(frame.subarray(headerLength, headerLength + 4), mask);
        // The decoder unmasks, so a round trip must give the payload back.
        const [message] = new FrameDecoder().push(frame);
        assert.deepEqual(message, { type: 'binary', data: payload });
    }
});

test('encodes a close frame with its status code', () => {
    const [message] = new FrameDecoder().push(encodeClose(1000, Uint8Array.from([1, 2, 3, 4])));
    assert.deepEqual(message, { type: 'close', code: 1000, reason: '' });
});
