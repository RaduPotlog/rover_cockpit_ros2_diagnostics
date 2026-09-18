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

import React, { useEffect, useState } from 'react';

import {
    Alert,
    Content,
    Flex,
    FlexItem,
    Page,
    PageSection,
    Stack,
    Tab,
    Tabs,
    TabTitleText,
    Title,
} from "@patternfly/react-core";

import cockpit from 'cockpit';
import { RosProvider } from "./components/RosProvider";
import { useNamespace } from "./hooks/useNamespace";
import { ManualNamespace } from "./components/ManualNamespace";
import { DiagnosticsTab } from "./diagnostics/DiagnosticsTab";
import { NetworkingTab } from "./networking/NetworkingTab";
import { LedsTab } from "./leds/LedsTab";

const _ = cockpit.gettext;

// Tab keys double as the URL path (#/networking, #/leds); diagnostics is the root.
const TABS = ["diagnostics", "networking", "leds"] as const;
type TabKey = typeof TABS[number];

const tabFromLocation = (): TabKey => {
    const path = cockpit.location.path[0];
    return (TABS as readonly string[]).includes(path) ? path as TabKey : "diagnostics";
};

const useActiveTab = (): [TabKey, (tab: TabKey) => void] => {
    const [tab, setTab] = useState<TabKey>(tabFromLocation);

    useEffect(() => {
        const update = () => setTab(tabFromLocation());
        cockpit.addEventListener("locationchanged", update);
        return () => cockpit.removeEventListener("locationchanged", update);
    }, []);

    return [tab, (next: TabKey) => cockpit.location.go(next === "diagnostics" ? [] : [next])];
};

export const Application = () => {
    const {
        namespace,
        setManualNamespace,
        invalidNamespaceMessage,
        manualEntryRequired
    } = useNamespace();
    const [activeTab, setActiveTab] = useActiveTab();
    const namespaceValid = !invalidNamespaceMessage;

    return (
        <RosProvider>
            <Page id="ros2-diag" className='no-masthead-sidebar'>
                <PageSection>
                    <Stack hasGutter>
                        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
                            <FlexItem>
                                <img className="rover-logo" src="logo.png" alt={_("Mechatronics Academy")} />
                            </FlexItem>
                            <FlexItem>
                                <Title headingLevel="h1" size="2xl">{_("Rover A1")}</Title>
                                <Content component="small">{_("Mechatronics Academy")}</Content>
                            </FlexItem>
                        </Flex>
                        <Tabs
                            activeKey={activeTab}
                            onSelect={(_event, key) => setActiveTab(key as TabKey)}
                            aria-label={_("Rover pages")}
                        >
                            <Tab eventKey="diagnostics" title={<TabTitleText>{_("ROS 2 Diagnostics")}</TabTitleText>} />
                            <Tab eventKey="networking" title={<TabTitleText>{_("ROS 2 Networking")}</TabTitleText>} />
                            <Tab eventKey="leds" title={<TabTitleText>{_("ROS 2 LEDs")}</TabTitleText>} />
                        </Tabs>
                        {invalidNamespaceMessage && activeTab !== "networking" && (
                            <Alert
                                variant="danger"
                                title={invalidNamespaceMessage} // Display error message if namespace is invalid
                            />
                        )}
                        { manualEntryRequired && activeTab !== "networking" && (
                            <ManualNamespace
                                setManualNamespace={setManualNamespace}
                                namespace={namespace}
                            />
                        )}
                        {/* Diagnostics stays mounted so its history survives tab switches;
                            the other tabs only ping / subscribe while they are shown. */}
                        <div hidden={activeTab !== "diagnostics"}>
                            <DiagnosticsTab namespace={namespace} namespaceValid={namespaceValid} />
                        </div>
                        {activeTab === "networking" && <NetworkingTab />}
                        {activeTab === "leds" && <LedsTab namespace={namespace} namespaceValid={namespaceValid} />}
                    </Stack>
                </PageSection>
            </Page>
        </RosProvider>
    );
};
