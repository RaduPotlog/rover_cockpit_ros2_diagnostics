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

import { parsePingRtt, type ProbeResult } from './model';

/**
 * One ICMP echo via the host's ping, spawned by the Cockpit bridge (the
 * rover-cockpit container shares the host network; ping needs NET_RAW).
 */
export const pingOnce = async (address: string, timeoutSeconds: number): Promise<ProbeResult> => {
    const checked_at = new Date().toISOString();
    try {
        const output = await cockpit.spawn(
            ["ping", "-n", "-c", "1", "-W", String(timeoutSeconds), address],
            { err: "out" },
        );
        return { reachable: true, latency_ms: parsePingRtt(output), checked_at, error: null };
    } catch (error) {
        const problem = (error as cockpit.ProcessError).problem;
        // problem is set when ping could not run at all (not installed, not permitted, ...);
        // a plain non-zero exit status means no echo reply came back.
        return {
            reachable: false,
            latency_ms: null,
            checked_at,
            error: problem ? `ping failed: ${(error as cockpit.ProcessError).message}` : "No ICMP response",
        };
    }
};
