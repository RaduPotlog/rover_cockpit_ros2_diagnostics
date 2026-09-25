/*
 * This file is part of Cockpit ROS 2 Diagnostics.
 *
 * Copyright (C) 2025 Clearpath Robotics, Inc., a Rockwell Automation Company. All rights reserved.
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

import * as ROSLIB from '../roslib/index';
import { useRos } from '../components/RosProvider';
import {
    rcSnapshot,
    type RcCalibrationStateMsg,
    type RcChannelsMsg,
    type RcInputs,
    type RcLinkStatusMsg,
    type RcReference,
    type RcSnapshot,
} from './model';

/**
 * Sticks have to feel live, so this is much shorter than the LEDs tab's 500 ms. rc/channels
 * arrives at rover_crsf_teleop's rc_topics_rate_hz (25 Hz shipped), so React re-renders ten
 * times a second, not twenty-five.
 */
const REFRESH_MS = 100;

const emptyInputs = (): RcInputs => ({
    channels: null,
    channelsAt: null,
    link: null,
    linkAt: null,
    calibration: null,
});

/**
 * Follow rover_crsf_teleop through the shared bridge connection and return a snapshot, rebuilt
 * every REFRESH_MS. Frames arrive at up to 25 Hz; only the latest one is kept between refreshes.
 *
 * `revision` increments whenever the calibration state changes, so the tab can react to a phase
 * the node decided on - a timeout, say - without polling the snapshot itself.
 */
export const useRcState = (namespace: string, reference: RcReference): RcSnapshot => {
    const { ros, connected, session } = useRos();
    const [snapshot, setSnapshot] = useState<RcSnapshot>(
        () => rcSnapshot(emptyInputs(), reference, Date.now()));

    useEffect(() => {
        const inputs = emptyInputs();
        const topics: ROSLIB.Topic<never>[] = [];

        const refresh = () => setSnapshot(rcSnapshot(inputs, reference, Date.now()));

        if (ros && connected && namespace) {
            const subscribe = <T, >(name: string, messageType: string, callback: (msg: T) => void) => {
                const topic = new ROSLIB.Topic<T>({ ros, name, messageType });
                topic.subscribe(callback);
                topics.push(topic as unknown as ROSLIB.Topic<never>);
            };

            subscribe<RcChannelsMsg>(`${namespace}/rc/channels`, "rover_msgs/msg/RcChannels", msg => {
                inputs.channels = msg;
                inputs.channelsAt = Date.now();
            });
            subscribe<RcLinkStatusMsg>(`${namespace}/rc/link`, "rover_msgs/msg/RcLinkStatus", msg => {
                inputs.link = msg;
                inputs.linkAt = Date.now();
            });
            // Transient local on the node's side, so the current phase arrives right away rather
            // than at the next heartbeat.
            subscribe<RcCalibrationStateMsg>(
                `${namespace}/rc/calibration/state`, "rover_msgs/msg/RcCalibrationState",
                msg => {
                    inputs.calibration = msg;
                    // Out of band: a phase change must not wait up to REFRESH_MS to be shown,
                    // because the wizard's buttons follow it.
                    refresh();
                });
        }

        refresh();
        const interval = setInterval(refresh, REFRESH_MS);

        return () => {
            clearInterval(interval);
            topics.forEach(topic => topic.unsubscribe());
        };
    }, [ros, connected, session, namespace, reference]);

    return snapshot;
};
