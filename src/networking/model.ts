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
 * ICMP reachability model of the rover network, ported from rover_network_monitor.
 * Pure: no cockpit, React or DOM imports, so it runs under `node --test`.
 */

export const HISTORY_LIMIT = 60;

export type InterfaceState = "online" | "offline" | "unknown";
export type DeviceState = "online" | "partial" | "offline" | "unknown";
export const DEVICE_STATES: readonly DeviceState[] = ["online", "partial", "offline", "unknown"];

export interface InterfaceConfig { name: string; address: string }
export interface DeviceConfig { id: string; name: string; role: string; interfaces: InterfaceConfig[] }

export interface ProbeResult {
    reachable: boolean;
    latency_ms: number | null;
    checked_at: string;
    error: string | null;
}

export interface InterfaceStatus extends InterfaceConfig {
    status: InterfaceState;
    latency_ms: number | null;
    checked_at: string | null;
    error: string | null;
    history: ProbeResult[];
}

export interface DeviceStatus extends Omit<DeviceConfig, "interfaces"> {
    status: DeviceState;
    interfaces: InterfaceStatus[];
}

const LATENCY_PATTERN = /time[=<]([0-9.]+)\s*ms/;

/** Round-trip time in ms from `ping` output, or null when it has none. */
export const parsePingRtt = (output: string): number | null => {
    const match = LATENCY_PATTERN.exec(output);
    return match ? Number.parseFloat(match[1]) : null;
};

export const deviceState = (states: InterfaceState[]): DeviceState => {
    if (states.includes("unknown")) return "unknown";
    if (states.every(state => state === "online")) return "online";
    return states.includes("online") ? "partial" : "offline";
};

const historyKey = (deviceId: string, address: string) => `${deviceId} ${address}`;

/** The last HISTORY_LIMIT probes of every interface. */
export class NetworkHistory {
    readonly #devices: DeviceConfig[];
    readonly #history = new Map<string, ProbeResult[]>();

    constructor(devices: DeviceConfig[]) {
        this.#devices = devices;
        for (const device of devices) {
            for (const iface of device.interfaces) {
                this.#history.set(historyKey(device.id, iface.address), []);
            }
        }
    }

    /** Every probed address, in the order record() expects its results. */
    addresses(): string[] {
        return this.#devices.flatMap(device => device.interfaces.map(iface => iface.address));
    }

    /** Record one sweep; results[i] belongs to addresses()[i]. */
    record(results: ProbeResult[]) {
        const keys = this.#devices.flatMap(device =>
            device.interfaces.map(iface => historyKey(device.id, iface.address)));
        keys.forEach((key, index) => {
            const samples = this.#history.get(key);
            const result = results[index];
            if (!samples || !result) return;
            samples.push(result);
            if (samples.length > HISTORY_LIMIT) samples.splice(0, samples.length - HISTORY_LIMIT);
        });
    }

    snapshot(): DeviceStatus[] {
        return this.#devices.map(device => {
            const interfaces = device.interfaces.map((iface): InterfaceStatus => {
                const samples = this.#history.get(historyKey(device.id, iface.address)) ?? [];
                const latest = samples[samples.length - 1];
                return {
                    ...iface,
                    status: !latest ? "unknown" : latest.reachable ? "online" : "offline",
                    latency_ms: latest ? latest.latency_ms : null,
                    checked_at: latest ? latest.checked_at : null,
                    error: latest ? latest.error : null,
                    history: samples.map(sample => ({ ...sample })),
                };
            });
            return {
                ...device,
                interfaces,
                status: deviceState(interfaces.map(iface => iface.status)),
            };
        });
    }
}

export const summarize = (devices: DeviceStatus[]): Record<DeviceState, number> => {
    const summary: Record<DeviceState, number> = { online: 0, partial: 0, offline: 0, unknown: 0 };
    for (const device of devices) summary[device.status] += 1;
    return summary;
};

export interface HistoryStats {
    probes: number;
    lossPercent: number;
    averageMs: number | null;
}

export const historyStats = (history: ProbeResult[]): HistoryStats => {
    const probes = history.length;
    const lost = history.filter(sample => !sample.reachable).length;
    const latencies = history.flatMap(sample => sample.latency_ms == null ? [] : [sample.latency_ms]);
    return {
        probes,
        lossPercent: probes ? Math.round((lost / probes) * 100) : 0,
        averageMs: latencies.length
            ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100
            : null,
    };
};

// ------------------------------------------------------------------ topology

export interface TopologyEnd { node: string; port?: string; interface?: string }
export interface TopologyLink { medium?: "wireless"; cable?: "cross" | "straight"; a: TopologyEnd; b: TopologyEnd }
export interface TopologyNode { id: string; name: string; model: string; kind: string; x: number; y: number; device?: string }
export interface Topology { name?: string; viewBox?: number[]; nodes: TopologyNode[]; links: TopologyLink[] }

export type LightState = InterfaceState | "unmonitored";

/** The monitored interface behind one end of a link, if any. */
export const interfaceOf = (
    devicesById: Map<string, DeviceStatus>,
    node: TopologyNode | undefined,
    end: TopologyEnd,
): InterfaceStatus | null => {
    if (!end.interface || !node?.device) return null;
    return devicesById.get(node.device)?.interfaces.find(iface => iface.name === end.interface) ?? null;
};

/**
 * A port with no probed address (switch, upstream Wi-Fi) mirrors the far end:
 * if the host behind it answers, the cable between them must be up.
 */
export const lightState = (own: InterfaceStatus | null, far: InterfaceStatus | null): LightState => {
    if (own) return own.status;
    if (far) return far.status;
    return "unmonitored";
};
