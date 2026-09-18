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

import React, { useState } from 'react';

import {
    Button,
    Flex,
    FlexItem,
    Stack,
    Title
} from "@patternfly/react-core";
import { PauseIcon, PlayIcon } from "@patternfly/react-icons";

import cockpit from 'cockpit';
import { DiagnosticsStatus } from "../interfaces";
import { DiagnosticsTable } from "../components/DiagnosticsTable";
import { DiagnosticsTreeTable } from "../components/DiagnosticsTreeTable";
import { RosConnectionManager } from "../components/RosConnectionManager";
import { useRos } from "../components/RosProvider";
import { DiagnosticsCapture } from "../components/DiagnosticsCapture";
import { HistorySelection } from "../components/HistorySelection";
import { useDiagHistory } from '../hooks/useDiagHistory';

const _ = cockpit.gettext;

// The original single-page ROS 2 Diagnostics view (aggregated /diagnostics_agg).
export const DiagnosticsTab = ({ namespace, namespaceValid }: { namespace: string; namespaceValid: boolean }) => {
    const { connected: bridgeConnected } = useRos();
    const [diagStatusDisplay, setDiagStatusDisplay] = useState<DiagnosticsStatus | null>(null); // DiagStatus data for display
    const [selectedRawName, setSelectedRawName] = useState<string | null>(null); // Used as identifier for diag entry so that values get updated
    const [isPaused, setIsPaused] = useState(false); // Pause state for diagnostics updates

    const {
        diagHistory,
        updateDiagHistory,
        clearDiagHistory
    } = useDiagHistory(isPaused);

    // Extract diagnostics array from DiagnosticsStatus for components that need it
    const diagnostics = diagStatusDisplay?.diagnostics || [];

    return (
        <Stack hasGutter>
            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem>
                    <Title headingLevel="h2" size="xl">
                        {_("ROS 2 Diagnostics")}
                    </Title>
                </FlexItem>
                <FlexItem>
                    <Button
                        variant="secondary"
                        icon={isPaused ? <PlayIcon /> : <PauseIcon />}
                        onClick={() => {
                            if (isPaused) clearDiagHistory();
                            setIsPaused(!isPaused);
                        }}
                        aria-label={isPaused ? _("Resume diagnostics updates") : _("Pause diagnostics updates")}
                    >
                        {isPaused ? _("Resume") : _("Pause")}
                    </Button>
                </FlexItem>
            </Flex>
            <HistorySelection
                diagHistory={diagHistory}
                setDiagStatusDisplay={setDiagStatusDisplay}
                isPaused={isPaused}
                setIsPaused={setIsPaused}
            />
            <DiagnosticsCapture namespace={namespace} />
            { namespaceValid && (
                <>
                    <RosConnectionManager
                        namespace={namespace}
                        onDiagnosticsUpdate={updateDiagHistory}
                        onClearHistory={clearDiagHistory}
                    />
                    {diagnostics.length > 0 && (
                        <>
                            <DiagnosticsTable diagnostics={diagnostics} setSelectedRawName={setSelectedRawName} variant="error" />
                            <DiagnosticsTable diagnostics={diagnostics} setSelectedRawName={setSelectedRawName} variant="warning" />
                        </>
                    )}
                    <DiagnosticsTreeTable
                        diagnostics={diagnostics}
                        bridgeConnected={bridgeConnected}
                        selectedRawName={selectedRawName}
                        setSelectedRawName={setSelectedRawName}
                    />
                </>
            )}
        </Stack>
    );
};
