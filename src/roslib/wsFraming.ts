/*
 * This file is part of Cockpit ROS 2 Diagnostics.
 *
 * Cockpit ROS 2 Diagnostics is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit ROS 2 Diagnostics is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * Minimal RFC 6455 WebSocket *client* pieces: the opening handshake and frame
 * encoding/decoding. CockpitWebSocket runs them over a raw TCP stream that the
 * Cockpit bridge opens to foxglove_bridge, because Cockpit's Python bridge has
 * no WebSocket channel of its own.
 *
 * Pure: no cockpit, React or DOM imports, so it runs under `node --test`.
 */

export const OPCODE = {
    CONTINUATION: 0x0,
    TEXT: 0x1,
    BINARY: 0x2,
    CLOSE: 0x8,
    PING: 0x9,
    PONG: 0xa,
} as const;

export type WsMessage =
    | { type: "text"; data: string }
    | { type: "binary"; data: Uint8Array }
    | { type: "ping"; data: Uint8Array }
    | { type: "pong"; data: Uint8Array }
    | { type: "close"; code: number; reason: string };

const HEADER_END = [13, 10, 13, 10]; // "\r\n\r\n"

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    if (a.length === 0) return b;
    if (b.length === 0) return a;
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
};

export const buildHandshake = (host: string, path: string, protocols: readonly string[], key: string): string => [
    `GET ${path} HTTP/1.1`,
    `Host: ${host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    ...(protocols.length ? [`Sec-WebSocket-Protocol: ${protocols.join(", ")}`] : []),
    "",
    "",
].join("\r\n");

export interface HandshakeResponse {
    status: number;
    protocol: string;
    /** Bytes received after the header: the start of the frame stream. */
    rest: Uint8Array;
}

/**
 * Parse the server's reply to the upgrade request, or return null while the
 * header is still incomplete. Sec-WebSocket-Accept is not verified: that needs
 * SHA-1 (crypto.subtle, missing on plain-http pages) and the peer is a socket
 * the Cockpit bridge opened on the rover itself.
 */
export const parseHandshakeResponse = (bytes: Uint8Array): HandshakeResponse | null => {
    let end = -1;
    for (let i = 0; i + 3 < bytes.length; i++) {
        if (bytes[i] === HEADER_END[0] && bytes[i + 1] === HEADER_END[1] &&
            bytes[i + 2] === HEADER_END[2] && bytes[i + 3] === HEADER_END[3]) {
            end = i;
            break;
        }
    }
    if (end < 0) return null;

    const lines = new TextDecoder().decode(bytes.subarray(0, end))
            .split("\r\n");
    const status = Number.parseInt(lines[0]?.split(" ")[1] ?? "", 10);
    let protocol = "";
    for (const line of lines.slice(1)) {
        const colon = line.indexOf(":");
        if (colon > 0 && line.slice(0, colon).trim()
                .toLowerCase() === "sec-websocket-protocol") {
            protocol = line.slice(colon + 1).trim();
        }
    }
    return { status: Number.isNaN(status) ? 0 : status, protocol, rest: bytes.slice(end + 4) };
};

/** One final (FIN) client frame. Client frames must be masked (RFC 6455 §5.3). */
export const encodeFrame = (opcode: number, payload: Uint8Array, maskKey: Uint8Array): Uint8Array => {
    const length = payload.length;
    const extended = length < 126 ? 0 : length < 0x10000 ? 2 : 8;
    const frame = new Uint8Array(2 + extended + 4 + length);
    frame[0] = 0x80 | (opcode & 0x0f);
    if (extended === 0) {
        frame[1] = 0x80 | length;
    } else if (extended === 2) {
        frame[1] = 0x80 | 126;
        frame[2] = length >>> 8;
        frame[3] = length & 0xff;
    } else {
        frame[1] = 0x80 | 127;
        new DataView(frame.buffer).setBigUint64(2, BigInt(length));
    }
    const maskAt = 2 + extended;
    frame.set(maskKey.subarray(0, 4), maskAt);
    for (let i = 0; i < length; i++) {
        frame[maskAt + 4 + i] = payload[i] ^ maskKey[i & 3];
    }
    return frame;
};

export const encodeClose = (code: number, maskKey: Uint8Array): Uint8Array => {
    const payload = new Uint8Array(2);
    payload[0] = code >>> 8;
    payload[1] = code & 0xff;
    return encodeFrame(OPCODE.CLOSE, payload, maskKey);
};

/**
 * Turns an arbitrarily chunked byte stream into complete messages: buffers
 * partial frames, reassembles fragmented messages and unmasks masked frames.
 * Control frames may arrive between the fragments of a data message.
 */
export class FrameDecoder {
    #buffer: Uint8Array = new Uint8Array(0);
    #fragments: Uint8Array[] = [];
    #fragmentOpcode = 0;
    readonly #text = new TextDecoder();

    push(chunk: Uint8Array): WsMessage[] {
        this.#buffer = concat(this.#buffer, chunk);
        const messages: WsMessage[] = [];

        for (;;) {
            const buffer = this.#buffer;
            if (buffer.length < 2) break;
            const fin = (buffer[0] & 0x80) !== 0;
            const opcode = buffer[0] & 0x0f;
            const masked = (buffer[1] & 0x80) !== 0;
            let length = buffer[1] & 0x7f;
            let offset = 2;
            if (length === 126) {
                if (buffer.length < 4) break;
                length = (buffer[2] << 8) | buffer[3];
                offset = 4;
            } else if (length === 127) {
                if (buffer.length < 10) break;
                const big = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getBigUint64(2);
                if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large");
                length = Number(big);
                offset = 10;
            }
            const maskAt = offset;
            if (masked) offset += 4;
            if (buffer.length < offset + length) break;

            const payload = buffer.slice(offset, offset + length);
            if (masked) {
                for (let i = 0; i < length; i++) payload[i] ^= buffer[maskAt + (i & 3)];
            }
            this.#buffer = buffer.subarray(offset + length);

            const message = this.#frame(fin, opcode, payload);
            if (message) messages.push(message);
        }
        return messages;
    }

    #frame(fin: boolean, opcode: number, payload: Uint8Array): WsMessage | null {
        switch (opcode) {
        case OPCODE.PING:
            return { type: "ping", data: payload };
        case OPCODE.PONG:
            return { type: "pong", data: payload };
        case OPCODE.CLOSE:
            return {
                type: "close",
                code: payload.length >= 2 ? (payload[0] << 8) | payload[1] : 1005,
                reason: payload.length > 2 ? this.#text.decode(payload.subarray(2)) : "",
            };
        case OPCODE.TEXT:
        case OPCODE.BINARY:
            this.#fragmentOpcode = opcode;
            this.#fragments = [payload];
            break;
        case OPCODE.CONTINUATION:
            this.#fragments.push(payload);
            break;
        default:
            throw new Error(`Unknown WebSocket opcode ${opcode}`);
        }
        if (!fin) return null;

        const data = this.#fragments.length === 1
            ? this.#fragments[0]
            : this.#fragments.reduce(concat, new Uint8Array(0));
        this.#fragments = [];
        return this.#fragmentOpcode === OPCODE.TEXT
            ? { type: "text", data: this.#text.decode(data) }
            : { type: "binary", data };
    }
}
