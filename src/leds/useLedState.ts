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

import * as ROSLIB from '../roslib/index';
import { useRos } from '../components/RosProvider';
import {
    decodeRgba,
    ledSnapshot,
    type LedAnimationInfoMsg,
    type LedInputs,
    type LedReference,
    type LedSnapshot,
    type LedStateMsg,
    type Rgba,
} from './model';

const REFRESH_MS = 500;

interface ImageMsg { data: Uint8Array; height?: number }

/**
 * Follow rover_led through the shared bridge connection and return a snapshot,
 * rebuilt every REFRESH_MS. Frames arrive at 50 Hz; only the latest one per
 * channel is kept and it is decoded once per refresh.
 */
export const useLedState = (
    namespace: string,
    reference: LedReference,
    channels: readonly number[],
): LedSnapshot => {
    const { ros, connected, session } = useRos();
    const [snapshot, setSnapshot] = useState<LedSnapshot>(() => ledSnapshot(
        {
            catalog: null,
            state: null,
            stateAt: null,
            frames: new Map(channels.map(channel => [channel, null])),
            brightness: null,
        },
        reference, Date.now()));

    useEffect(() => {
        const inputs: LedInputs = {
            catalog: null,
            state: null,
            stateAt: null,
            frames: new Map(channels.map(channel => [channel, null])),
            brightness: null,
        };
        const rawFrames = new Map<number, { msg: ImageMsg; at: number }>();
        const topics: ROSLIB.Topic<never>[] = [];

        const refresh = () => {
            for (const [channel, raw] of rawFrames) {
                inputs.frames.set(channel, { leds: decodeRgba(raw.msg) as Rgba[], rows: raw.msg.height || 1, at: raw.at });
            }
            rawFrames.clear();
            setSnapshot(ledSnapshot(inputs, reference, Date.now()));
        };

        if (ros && connected) {
            const subscribe = <T, >(name: string, messageType: string, callback: (msg: T) => void) => {
                const topic = new ROSLIB.Topic<T>({ ros, name, messageType });
                topic.subscribe(callback);
                topics.push(topic as unknown as ROSLIB.Topic<never>);
            };
            subscribe<{ animations: LedAnimationInfoMsg[] }>(
                `${namespace}/led/animations`, "rover_msgs/msg/LedAnimationCatalog",
                msg => { inputs.catalog = msg.animations });
            subscribe<LedStateMsg>(`${namespace}/led/state`, "rover_msgs/msg/LedState", msg => {
                inputs.state = msg;
                inputs.stateAt = Date.now();
            });
            subscribe<{ data: number }>(`${namespace}/led/brightness`, "std_msgs/msg/Float32",
                                        msg => { inputs.brightness = msg.data });
            for (const channel of channels) {
                subscribe<ImageMsg>(`${namespace}/led/channel_${channel}_frame`, "sensor_msgs/msg/Image",
                                    msg => { rawFrames.set(channel, { msg, at: Date.now() }) });
            }
        }

        refresh();
        const interval = setInterval(refresh, REFRESH_MS);
        return () => {
            clearInterval(interval);
            topics.forEach(topic => topic.unsubscribe());
        };
    }, [ros, connected, session, namespace, reference, channels]);

    return snapshot;
};
