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

import React, { useEffect, useRef, useState } from 'react';
import {
    Card,
    CardBody,
    CardFooter,
    CardHeader,
    CardTitle,
    ExpandableSection,
    Gallery,
    Label,
    Content,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";

import cockpit from 'cockpit';
import { HISTORY_LIMIT, historyStats, type DeviceState, type DeviceStatus, type InterfaceStatus, type ProbeResult } from './model';

const _ = cockpit.gettext;

const STATUS_COLOR: Record<DeviceState, "green" | "orange" | "red" | "grey"> = {
    online: "green", partial: "orange", offline: "red", unknown: "grey",
};

export const StatusLabel = ({ status }: { status: DeviceState }) => (
    <Label color={STATUS_COLOR[status]} isCompact>{status}</Label>
);

const show = (value: number | null, suffix = "") => (value == null ? "—" : `${value}${suffix}`);
const formatTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString() : "—");

/** RTT over the last HISTORY_LIMIT probes; failed probes are red ticks on the baseline. */
const Sparkline = ({ history }: { history: ProbeResult[] }) => {
    const w = 300; const h = 44; const pad = 4;
    const step = (w - pad * 2) / (HISTORY_LIMIT - 1);
    const offset = HISTORY_LIMIT - history.length;
    const max = Math.max(1, ...history.flatMap(s => (s.reachable && s.latency_ms != null ? [s.latency_ms] : [])));
    const points: string[] = [];
    const failures: number[] = [];
    history.forEach((sample, i) => {
        const x = pad + (offset + i) * step;
        if (sample.reachable && sample.latency_ms != null) {
            points.push(`${x.toFixed(1)},${(h - pad - (sample.latency_ms / max) * (h - pad * 2)).toFixed(1)}`);
        } else if (!sample.reachable) {
            failures.push(x);
        }
    });
    return (
        <svg className="network-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
            {points.length > 1 && <polyline className="network-spark-line" points={points.join(" ")} />}
            {failures.map(x => <rect key={x} className="network-spark-fail" x={(x - 1.5).toFixed(1)} y={h - 8} width="3" height="6" />)}
        </svg>
    );
};

const InterfaceHistory = ({ iface }: { iface: InterfaceStatus }) => {
    const stats = historyStats(iface.history);
    return (
        <div className="network-history">
            <strong>{iface.name}</strong> · <code>{iface.address}</code>
            <Sparkline history={iface.history} />
            <Content component="small">
                {cockpit.format(_("$0 probes · $1% loss · avg $2"), stats.probes, stats.lossPercent, show(stats.averageMs, " ms"))}
                {iface.error && <span className="network-error"> · {iface.error}</span>}
            </Content>
        </div>
    );
};

const DeviceCard = ({ device, selected }: { device: DeviceStatus; selected: boolean }) => {
    const [expanded, setExpanded] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);
    const lastCheck = device.interfaces.map(iface => iface.checked_at).filter(Boolean)
            .sort()
            .pop();

    // Clicking a device in the topology opens its history and brings it into view.
    useEffect(() => {
        if (!selected) return;
        setExpanded(true);
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, [selected]);

    return (
        <Card ref={cardRef} className={`network-device network-device-${device.status}${selected ? " network-device-selected" : ""}`}>
            <CardHeader actions={{ actions: <StatusLabel status={device.status} />, hasNoOffset: true }}>
                <CardTitle>{device.name}</CardTitle>
                <Content component="small">{device.role}</Content>
            </CardHeader>
            <CardBody>
                <Table variant="compact" aria-label={cockpit.format(_("$0 interfaces"), device.name)}>
                    <Thead>
                        <Tr>
                            <Th>{_("Iface")}</Th>
                            <Th>{_("Address")}</Th>
                            <Th>{_("Status")}</Th>
                            <Th>{_("Latency")}</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {device.interfaces.map(iface => (
                            <Tr key={iface.address}>
                                <Td dataLabel={_("Iface")}>{iface.name}</Td>
                                <Td dataLabel={_("Address")}><code>{iface.address}</code></Td>
                                <Td dataLabel={_("Status")}><StatusLabel status={iface.status} /></Td>
                                <Td dataLabel={_("Latency")}>{show(iface.latency_ms, " ms")}</Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
                <ExpandableSection
                    toggleText={expanded ? _("Hide history") : _("Show history")}
                    isExpanded={expanded}
                    onToggle={(_event, value) => setExpanded(value)}
                >
                    {device.interfaces.map(iface => <InterfaceHistory key={iface.address} iface={iface} />)}
                </ExpandableSection>
            </CardBody>
            <CardFooter>
                <Content component="small">{cockpit.format(_("Last check $0"), formatTime(lastCheck))}</Content>
            </CardFooter>
        </Card>
    );
};

export const DeviceCards = ({ devices, selectedId }: { devices: DeviceStatus[]; selectedId: string | null }) => (
    <Gallery hasGutter minWidths={{ default: "320px" }}>
        {devices.map(device => <DeviceCard key={device.id} device={device} selected={device.id === selectedId} />)}
    </Gallery>
);
