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

import cockpit from 'cockpit';
import type { IWebSocket } from '@foxglove/ws-protocol';

import {
    FrameDecoder,
    OPCODE,
    buildHandshake,
    encodeClose,
    encodeFrame,
    parseHandshakeResponse,
} from './wsFraming';

export interface BridgeAddress {
    address: string;
    port: number;
}

// "foxglove.sdk.v1" is what the foxglove-sdk based bridge (Jazzy and later) speaks; the
// @foxglove/ws-protocol package only knows the older "foxglove.websocket.v1" name. The
// protocols are compatible for our use, so offer both and let the bridge pick.
const PROTOCOLS = ["foxglove.sdk.v1", "foxglove.websocket.v1"];

const randomBytes = (count: number) => crypto.getRandomValues(new Uint8Array(count));

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * A WebSocket client (the IWebSocket FoxgloveClient expects) that runs over a TCP
 * stream opened by the Cockpit bridge on the rover, instead of a browser WebSocket.
 * The foxglove traffic therefore travels inside the Cockpit session on its own port,
 * so it works wherever the Cockpit page does (rover LAN, balena Public Device URL),
 * and foxglove_bridge's port never has to be reachable from the browser.
 */
export class CockpitWebSocket implements IWebSocket {
    binaryType = "arraybuffer";
    protocol = "";
    onerror: ((event: { error: Error }) => void) | null = null;
    onopen: ((event: object) => void) | null = null;
    onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
    onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;

    readonly #channel: cockpit.Channel<Uint8Array>;
    readonly #decoder = new FrameDecoder();
    readonly #encoder = new TextEncoder();
    #handshake: Uint8Array | null = new Uint8Array(0); // null once the upgrade completed
    #closed = false;

    constructor({ address, port }: BridgeAddress) {
        this.#channel = cockpit.channel({ payload: "stream", address, port, binary: true });
        this.#channel.addEventListener("message", (_event, data) => this.#receive(data));
        this.#channel.addEventListener("close", (_event, options) => {
            const problem = typeof options?.problem === "string" ? options.problem : null;
            this.#finish(problem ? 1006 : 1000, problem ?? "", !problem);
        });
        this.#channel.send(this.#encoder.encode(
            buildHandshake(`${address}:${port}`, "/", PROTOCOLS, base64(randomBytes(16)))));
    }

    send(data: string | ArrayBuffer | ArrayBufferView) {
        if (this.#closed || this.#handshake !== null) return;
        if (typeof data === "string") {
            this.#write(OPCODE.TEXT, this.#encoder.encode(data));
        } else if (data instanceof ArrayBuffer) {
            this.#write(OPCODE.BINARY, new Uint8Array(data));
        } else {
            this.#write(OPCODE.BINARY, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
    }

    close() {
        if (this.#closed) return;
        if (this.#handshake === null) this.#channel.send(encodeClose(1000, randomBytes(4)));
        this.#channel.close();
        this.#finish(1000, "", true);
    }

    #write(opcode: number, payload: Uint8Array) {
        this.#channel.send(encodeFrame(opcode, payload, randomBytes(4)));
    }

    #receive(chunk: Uint8Array) {
        if (this.#closed) return;
        let bytes = chunk;
        if (this.#handshake !== null) {
            const response = parseHandshakeResponse(this.#handshake = concatBytes(this.#handshake, chunk));
            if (!response) return;
            if (response.status !== 101) {
                this.#fail(`foxglove_bridge refused the WebSocket upgrade (HTTP ${response.status})`);
                return;
            }
            this.#handshake = null;
            this.protocol = response.protocol;
            this.onopen?.({});
            bytes = response.rest;
            if (bytes.length === 0) return;
        }

        let messages;
        try {
            messages = this.#decoder.push(bytes);
        } catch (error) {
            this.#fail(String((error as Error)?.message ?? error));
            return;
        }
        for (const message of messages) {
            if (this.#closed) return;
            switch (message.type) {
            case "text":
                this.onmessage?.({ data: message.data });
                break;
            case "binary":
                // A standalone ArrayBuffer, as a browser WebSocket with binaryType "arraybuffer" gives.
                this.onmessage?.({ data: message.data.slice().buffer });
                break;
            case "ping":
                this.#write(OPCODE.PONG, message.data);
                break;
            case "pong":
                break;
            case "close":
                this.#channel.send(encodeClose(message.code === 1005 ? 1000 : message.code, randomBytes(4)));
                this.#channel.close();
                this.#finish(message.code, message.reason, true);
                break;
            }
        }
    }

    #fail(reason: string) {
        this.onerror?.({ error: new Error(reason) });
        this.#channel.close();
        this.#finish(1006, reason, false);
    }

    #finish(code: number, reason: string, wasClean: boolean) {
        if (this.#closed) return;
        this.#closed = true;
        this.onclose?.({ code, reason, wasClean });
    }
}

const concatBytes = (a: Uint8Array, b: Uint8Array) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
};
