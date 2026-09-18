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

import React, { createContext, useContext, useEffect, useState } from "react";

import * as ROSLIB from "../roslib/index";

export interface RosConnection {
    ros: ROSLIB.Ros | null;
    connected: boolean;
    // Incremented on every (re)connection. Each connection is a new bridge session, so
    // subscriptions must be re-created: consumers list it in their effect dependencies.
    session: number;
}

const RETRY_DELAY_MS = 3000;
const DISCONNECTED: RosConnection = { ros: null, connected: false, session: 0 };

const RosContext = createContext<RosConnection>(DISCONNECTED);

export const useRos = () => useContext(RosContext);

/**
 * Owns the page's single foxglove_bridge connection and reconnects every
 * RETRY_DELAY_MS until it is unmounted. Every tab shares it.
 */
export const RosProvider = ({ url, children }: { url: string | null; children: React.ReactNode }) => {
    const [connection, setConnection] = useState<RosConnection>(DISCONNECTED);

    useEffect(() => {
        if (!url) {
            console.warn("WebSocket URL is not set correctly. Skipping WebSocket configuration.");
            return;
        }

        const ros = new ROSLIB.Ros({});
        let session = 0;
        let retry = true;
        let retryTimeout: ReturnType<typeof setTimeout> | undefined;

        const connect = () => {
            clearTimeout(retryTimeout);
            ros.connect(url);

            ros.on("connection", () => {
                console.log("Connected to Foxglove bridge at " + url);
                session += 1;
                setConnection({ ros, connected: true, session });
            });

            ros.on("error", (error) => {
                console.error("Error connecting to Foxglove bridge:", error);
                ros.close();
            });

            ros.on("close", () => {
                console.log("Connection to Foxglove bridge closed");
                setConnection({ ros, connected: false, session });
                clearTimeout(retryTimeout);
                if (retry) {
                    console.log("Retrying WebSocket connection...");
                    retryTimeout = setTimeout(connect, RETRY_DELAY_MS);
                }
            });
        };

        connect();

        return () => {
            retry = false;
            clearTimeout(retryTimeout);
            ros.close();
            setConnection(DISCONNECTED);
        };
    }, [url]);

    return <RosContext.Provider value={connection}>{children}</RosContext.Provider>;
};
