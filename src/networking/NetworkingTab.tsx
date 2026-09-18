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

import React, { useState } from 'react';
import {
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    Content,
    Flex,
    FlexItem,
    Stack,
    Title,
} from "@patternfly/react-core";

import cockpit from 'cockpit';
import { DeviceCards, StatusLabel } from './DeviceCards';
import { NetworkTopology } from './NetworkTopology';
import { pingOnce } from './pinger';
import { useNetworkMonitor } from './useNetworkMonitor';
import { DEVICE_STATES, summarize, type DeviceConfig, type Topology } from './model';
import devicesJson from './devices.json';
import topologyJson from './topology.json';

const _ = cockpit.gettext;

// Module constants: stable identities, so the monitor effect never restarts on render.
const DEVICES = devicesJson as DeviceConfig[];
const TOPOLOGY = topologyJson as Topology;
const POLL_INTERVAL_MS = 5000;

/** ICMP status of every interface in the rover topology (port of rover_network_monitor). */
export const NetworkingTab = () => {
    const { devices, updatedAt } = useNetworkMonitor(DEVICES, pingOnce, { intervalMs: POLL_INTERVAL_MS });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const summary = summarize(devices);

    return (
        <Stack hasGutter>
            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem>
                    <Title headingLevel="h2" size="xl">{_("ROS 2 Networking")}</Title>
                    <Content component="small">
                        {_("ICMP status of every interface in the rover topology, pinged from the rover every 5 seconds.")}
                    </Content>
                </FlexItem>
                <FlexItem>
                    <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                        {DEVICE_STATES.map(state => (
                            <FlexItem key={state}>
                                <StatusLabel status={state} /> {summary[state]}
                            </FlexItem>
                        ))}
                        <FlexItem>
                            <Content component="small">
                                {updatedAt ? cockpit.format(_("Updated $0"), updatedAt.toLocaleTimeString()) : _("Probing…")}
                            </Content>
                        </FlexItem>
                    </Flex>
                </FlexItem>
            </Flex>
            <Card>
                <CardHeader>
                    <CardTitle>{_("Topology")}</CardTitle>
                    <Content component="small">{TOPOLOGY.name}</Content>
                </CardHeader>
                <CardBody>
                    <NetworkTopology topology={TOPOLOGY} devices={devices} selectedId={selectedId} onSelect={setSelectedId} />
                </CardBody>
            </Card>
            <DeviceCards devices={devices} selectedId={selectedId} />
        </Stack>
    );
};
