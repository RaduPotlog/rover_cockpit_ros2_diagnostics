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

import React, { useEffect, useRef } from "react";
import { Icon } from "@patternfly/react-core";
import {
    CheckCircleIcon,
    ExclamationCircleIcon,
    ExclamationTriangleIcon,
    QuestionCircleIcon,
} from "@patternfly/react-icons";

import { DiagnosticsEntry, DiagnosticsStatus } from "../interfaces";
import * as ROSLIB from "../roslib/index";
import { useRos } from "./RosProvider";

interface RosConnectionManagerProps {
    namespace: string;
    onDiagnosticsUpdate: (diagnosticsStatus: DiagnosticsStatus) => void;
    onClearHistory: () => void;
}

// Helper function to calculate overall diagnostic level
const calculateOverallLevel = (diagnostics: DiagnosticsEntry[]): number => {
    let maxLevel = 0;

    const checkEntry = (entry: DiagnosticsEntry) => {
        if (entry.severity_level > maxLevel) {
            maxLevel = entry.severity_level;
        }
        entry.children.forEach(checkEntry);
    };

    diagnostics.forEach(checkEntry);
    return maxLevel;
};

// Helper function to build a nested DiagnosticsEntry tree
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildDiagnosticsTree = (diagnostics: any[]): DiagnosticsEntry[] => {
    const root: DiagnosticsEntry[] = [];

    diagnostics.forEach(({ name, message, level, hardware_id, values }) => {
        const parts = name.split("/");
        let currentLevel = root;

        parts.forEach((part: string, index: number) => {
            if (!part) return; // Skip empty parts

            let existingEntry = currentLevel.find(entry => entry.name === part);

            if (!existingEntry) {
                const [baseName, suffix] = part.split(":");
                const path = parts.slice(0, index + 1).join("/")
                        .split(":")[0];
                existingEntry = {
                    name: index === parts.length - 1 && suffix ? suffix : baseName,
                    path,
                    rawName: path,
                    message: "",
                    severity_level: -1,
                    hardware_id: null,
                    values: null,
                    children: [],
                    icon: null, // Initialize icon as null
                };
                currentLevel.push(existingEntry);
            }

            if (index === parts.length - 1) {
                existingEntry.message = message || "";
                existingEntry.severity_level = level ?? -1;
                existingEntry.hardware_id = hardware_id || null;
                existingEntry.rawName = name;

                existingEntry.values = Array.isArray(values)
                    ? values.reduce((acc, { key, value }) => {
                        acc[key] = value;
                        return acc;
                    }, {})
                    : values && typeof values === "object"
                        ? Object.fromEntries(
                            Object.entries(values).map(([key, value]) => [key, value])
                        )
                        : {};

                // Populate the icon based on severity level
                existingEntry.icon = level === 3
                    ? <Icon status="info"><QuestionCircleIcon /></Icon>
                    : level === 2
                        ? <Icon status="danger"><ExclamationCircleIcon /></Icon>
                        : level === 1
                            ? <Icon status="warning"><ExclamationTriangleIcon /></Icon>
                            : <Icon status="success"><CheckCircleIcon /></Icon>;
            }

            currentLevel = existingEntry.children;
        });
    });

    return root;
};

export const RosConnectionManager: React.FC<RosConnectionManagerProps> = ({
    namespace,
    onDiagnosticsUpdate,
    onClearHistory
}) => {
    const { ros, connected, session } = useRos();
    const staleTimeoutId = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        // Whatever was shown belongs to the previous connection (or namespace).
        onClearHistory();
        if (!ros || !connected) return;

        const timeoutDuration = 5000; // 5 seconds
        const diagnosticsTopic = new ROSLIB.Topic({
            ros,
            name: `${namespace}/diagnostics_agg`,
            messageType: "diagnostic_msgs/DiagnosticArray",
        });

        diagnosticsTopic.subscribe((message) => {
            // Clear the timeout if a new message is received
            clearTimeout(staleTimeoutId.current);

            // Process incoming diagnostics messages
            if (Array.isArray(message.status)) {
                const diagnosticsTree = buildDiagnosticsTree(
                    message.status.map(({ name, message, level, hardware_id, values }) => ({
                        name,
                        message,
                        level: level !== undefined ? level : -1,
                        hardware_id,
                        values,
                    }))
                );

                // Calculate overall level from diagnostics tree
                const overallLevel = calculateOverallLevel(diagnosticsTree);

                // Extract timestamp from ROS message header
                let timestamp = Date.now(); // Default fallback
                if (message.header && message.header.stamp) {
                    // Convert ROS time (sec + nanosec) to JavaScript timestamp (milliseconds)
                    const sec = message.header.stamp.sec || 0;
                    const nanosec = message.header.stamp.nanosec || 0;
                    timestamp = sec * 1000 + Math.round(nanosec / 1000000);
                } else {
                    console.log("No header.stamp found in message, using current time");
                }

                // Create DiagStatus object
                const diagStatus: DiagnosticsStatus = {
                    timestamp,
                    level: overallLevel,
                    diagnostics: diagnosticsTree
                };

                onDiagnosticsUpdate(diagStatus);
            } else {
                console.warn("Unexpected diagnostics data format:", message);
            }

            // Set a timeout to clear stale diagnostics if no new message is received
            staleTimeoutId.current = setTimeout(() => {
                console.warn("No diagnostics message received for 5 seconds. Clearing stale diagnostics.");
                onClearHistory();
            }, timeoutDuration);
        });
        console.log(`Subscribed to topic: ${diagnosticsTopic.name}`);

        return () => {
            diagnosticsTopic.unsubscribe();
            clearTimeout(staleTimeoutId.current);
        };
    }, [ros, connected, session, namespace, onDiagnosticsUpdate, onClearHistory]);

    return null; // This component does not render anything
};
