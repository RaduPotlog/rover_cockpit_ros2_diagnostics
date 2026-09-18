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

import { useEffect, useState } from 'react';

import { NetworkHistory, type DeviceConfig, type DeviceStatus, type ProbeResult } from './model';

export interface NetworkSnapshot {
    devices: DeviceStatus[];
    updatedAt: Date | null;
}

type Prober = (address: string, timeoutSeconds: number) => Promise<ProbeResult>;

/**
 * Probe every interface of `devices` in parallel, then wait intervalMs before
 * the next sweep (chained, so a slow sweep never overlaps the next one).
 * Runs only while the calling component is mounted.
 */
export const useNetworkMonitor = (
    devices: DeviceConfig[],
    probe: Prober,
    { intervalMs = 5000, timeoutSeconds = 1 } = {},
): NetworkSnapshot => {
    const [snapshot, setSnapshot] = useState<NetworkSnapshot>(
        () => ({ devices: new NetworkHistory(devices).snapshot(), updatedAt: null }));

    useEffect(() => {
        const history = new NetworkHistory(devices);
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const sweep = async () => {
            const results = await Promise.all(history.addresses().map(address => probe(address, timeoutSeconds)));
            if (stopped) return;
            // Applied in one go after every probe resolved: never a half-updated sweep.
            history.record(results);
            setSnapshot({ devices: history.snapshot(), updatedAt: new Date() });
            timer = setTimeout(sweep, intervalMs);
        };

        sweep();
        return () => {
            stopped = true;
            clearTimeout(timer);
        };
    }, [devices, probe, intervalMs, timeoutSeconds]);

    return snapshot;
};
