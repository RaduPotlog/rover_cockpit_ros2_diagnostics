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

import React from 'react';

import cockpit from 'cockpit';
import { DEFS, LABEL_OFFSET, deviceIcon } from './icons';
import {
    interfaceOf,
    lightState,
    type DeviceStatus,
    type InterfaceStatus,
    type LightState,
    type Topology,
    type TopologyEnd,
    type TopologyNode,
} from './model';

const _ = cockpit.gettext;

const LIGHT_DISTANCE = 48; // how far from a device centre the link light sits
const LIGHT_DISTANCE_BELOW = 76; // cables leaving downwards must clear the label first
const ICON_ANCHOR_Y = -4; // cables meet the icon slightly above its origin

// `dy` is the vertical component of the unit vector pointing away from the device.
const lightDistance = (dy: number) => (dy > 0.5 ? LIGHT_DISTANCE_BELOW : LIGHT_DISTANCE);

const latency = (iface: InterfaceStatus) => (iface.latency_ms == null ? "" : ` · ${iface.latency_ms} ms`);

const describeEnd = (node: TopologyNode, end: TopologyEnd, iface: InterfaceStatus | null) => {
    const where = `${node.name}${end.port ? ` ${end.port}` : ""}`;
    if (!iface) return `${where}: ${_("not monitored")}`;
    return `${where}: ${iface.name} ${iface.address} · ${iface.status}${latency(iface)}`;
};

const describeNode = (node: TopologyNode, device: DeviceStatus | null) => {
    const head = `${node.name} · ${node.model}`;
    if (!device) return `${head}\n${_("Not monitored (no IP address)")}`;
    const rows = device.interfaces.map(iface => `${iface.name} ${iface.address} — ${iface.status}${latency(iface)}`);
    return [head, device.role, ...rows].join("\n");
};

const Light = ({ x, y, state }: { x: number; y: number; state: LightState }) => {
    if (state === "online") return <path className="light-online" d={`M${x} ${y - 6.5}L${x + 6.5} ${y + 5}H${x - 6.5}Z`} />;
    if (state === "offline") return <path className="light-offline" d={`M${x - 6.5} ${y - 5}H${x + 6.5}L${x} ${y + 6.5}Z`} />;
    return <circle className="light-unknown" cx={x} cy={y} r="4.5" />;
};

// Three arcs over a dot on a round plate, marking a radio link at its midpoint.
const WifiGlyph = ({ x, y }: { x: number; y: number }) => (
    <g className="wifi-glyph" transform={`translate(${x} ${y})`}>
        <circle className="wifi-plate" r="12" />
        <path className="wifi-arc" d="M-8 -1.5a11.3 11.3 0 0 1 16 0M-5.2 1.4a7.3 7.3 0 0 1 10.4 0M-2.5 4.2a3.5 3.5 0 0 1 5 0" />
        <circle className="wifi-dot" cy="7" r="1.4" />
    </g>
);

interface NetworkTopologyProps {
    topology: Topology;
    devices: DeviceStatus[];
    selectedId: string | null;
    onSelect: (deviceId: string) => void;
}

/** Packet-Tracer-style drawing of the rover network with a status light at each link end. */
export const NetworkTopology = ({ topology, devices, selectedId, onSelect }: NetworkTopologyProps) => {
    const [minX, minY, width, height] = topology.viewBox ?? [0, 0, 1000, 470];
    const devicesById = new Map(devices.map(device => [device.id, device]));
    const nodesById = new Map(topology.nodes.map(node => [node.id, node]));

    const links = topology.links.map((link, index) => {
        const nodeA = nodesById.get(link.a.node);
        const nodeB = nodesById.get(link.b.node);
        if (!nodeA || !nodeB) return null;
        const ax = nodeA.x; const ay = nodeA.y + ICON_ANCHOR_Y;
        const bx = nodeB.x; const by = nodeB.y + ICON_ANCHOR_Y;
        const length = Math.hypot(bx - ax, by - ay) || 1;
        const ux = (bx - ax) / length; const uy = (by - ay) / length;
        const ifaceA = interfaceOf(devicesById, nodeA, link.a);
        const ifaceB = interfaceOf(devicesById, nodeB, link.b);
        const wireless = link.medium === "wireless";
        const [cable, kind] = wireless
            ? ["cable cable-wireless", _("Wi-Fi link")]
            : link.cable === "cross" ? ["cable cable-cross", _("Crossover cable")] : ["cable", _("Straight-through cable")];
        const d = `M${ax} ${ay}L${bx} ${by}`;
        return (
            <g className="link" key={index}>
                <title>{[kind, describeEnd(nodeA, link.a, ifaceA), "↕", describeEnd(nodeB, link.b, ifaceB)].join("\n")}</title>
                <path className={cable} d={d} />
                <path className="link-hit" d={d} />
                {wireless && <WifiGlyph x={(ax + bx) / 2} y={(ay + by) / 2} />}
                <Light x={ax + ux * lightDistance(uy)} y={ay + uy * lightDistance(uy)} state={lightState(ifaceA, ifaceB)} />
                <Light x={bx - ux * lightDistance(-uy)} y={by - uy * lightDistance(-uy)} state={lightState(ifaceB, ifaceA)} />
            </g>
        );
    });

    const nodes = topology.nodes.map(node => {
        const device = node.device ? devicesById.get(node.device) ?? null : null;
        const classes = ["node", device ? "monitored" : "", device ? `status-${device.status}` : "",
            device && device.id === selectedId ? "selected" : ""].filter(Boolean).join(" ");
        // Rough text metrics are enough for a backing plate that hides cables under the label.
        const labelWidth = Math.max(node.name.length * 8.6, node.model.length * 7.2) + 12;
        const select = device ? () => onSelect(device.id) : undefined;
        return (
            <g
                key={node.id}
                className={classes}
                transform={`translate(${node.x} ${node.y})`}
                onClick={select}
                onKeyDown={select && (event => { if (event.key === "Enter" || event.key === " ") select(); })}
                role={device ? "button" : undefined}
                tabIndex={device ? 0 : undefined}
                aria-label={device ? node.name : undefined}
            >
                <title>{describeNode(node, device)}</title>
                <ellipse className="node-halo" cx="0" cy="-6" rx="42" ry="32" />
                {/* Static glyph markup from icons.ts, no user data. */}
                <g dangerouslySetInnerHTML={{ __html: deviceIcon(node.kind) }} />
                <rect className="label-plate" x={-labelWidth / 2} y={LABEL_OFFSET - 13} width={labelWidth} height="35" rx="4" />
                <text className="node-label" y={LABEL_OFFSET}>
                    <tspan className="node-model" x="0">{node.model}</tspan>
                    <tspan className="node-name" x="0" dy="16">{node.name}</tspan>
                </text>
            </g>
        );
    });

    return (
        <div className="network-topology">
            <svg viewBox={`${minX} ${minY} ${width} ${height}`} role="img" aria-label={_("Network topology diagram")}>
                <g dangerouslySetInnerHTML={{ __html: DEFS }} />
                <g>{links}</g>
                <g>{nodes}</g>
            </svg>
            <ul className="network-legend">
                <li><svg viewBox="0 0 14 12" aria-hidden="true"><path d="M7 1 13 11H1Z" className="light-online" /></svg>{_("Link up")}</li>
                <li><svg viewBox="0 0 14 12" aria-hidden="true"><path d="M1 1h12L7 11Z" className="light-offline" /></svg>{_("Link down")}</li>
                <li><svg viewBox="0 0 14 12" aria-hidden="true"><circle cx="7" cy="6" r="4.5" className="light-unknown" /></svg>{_("Not monitored / pending")}</li>
                <li><svg viewBox="0 0 28 12" aria-hidden="true"><line x1="1" y1="6" x2="27" y2="6" className="cable" /></svg>{_("Straight-through")}</li>
                <li><svg viewBox="0 0 28 12" aria-hidden="true"><line x1="1" y1="6" x2="27" y2="6" className="cable cable-cross" /></svg>{_("Crossover")}</li>
                <li><svg viewBox="0 0 28 12" aria-hidden="true"><line x1="2" y1="6" x2="26" y2="6" className="cable cable-wireless" /></svg>{_("Wi-Fi")}</li>
            </ul>
        </div>
    );
};
