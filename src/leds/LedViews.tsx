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
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    Content,
    Flex,
    Label,
    Progress,
    ProgressMeasureLocation,
    ProgressSize,
    Title,
} from "@patternfly/react-core";
import { PlayIcon, StopIcon } from "@patternfly/react-icons";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";

import cockpit from 'cockpit';
import { ledColor, type AnimationRow, type LedSnapshot } from './model';

const _ = cockpit.gettext;

const LAYER_COLOR: Record<string, "red" | "orange" | "blue" | "grey"> = {
    ERROR: "red", ALERT: "orange", INFO: "blue", STATE: "grey",
};

export const LayerLabel = ({ layer }: { layer: string | null }) => (
    <Label isCompact color={layer ? LAYER_COLOR[layer] ?? "grey" : "grey"}>{layer ?? "—"}</Label>
);

const ProgressBar = ({ progress, label }: { progress: number; label: string }) => (
    <Progress
        value={Math.round(Math.min(Math.max(progress ?? 0, 0), 1) * 100)}
        size={ProgressSize.sm}
        measureLocation={ProgressMeasureLocation.outside}
        aria-label={label}
    />
);

export const NowPlaying = ({ snapshot }: { snapshot: LedSnapshot }) => {
    const top = snapshot.top;
    return (
        <Card className="led-now">
            <CardBody>
                <Content component="small">{_("On top")}</Content>
                {top
                    ? (
                        <>
                            <Title headingLevel="h3" size="lg">{top.name} <Content component="small">#{top.id}</Content></Title>
                            <Content component="small">
                                <LayerLabel layer={top.layer} /> {cockpit.format(_("priority $0"), top.priority)}
                                {" · "}{top.repeating ? _("repeating") : _("one-shot")}
                                {top.param ? ` · ${cockpit.format(_("param $0"), top.param)}` : ""}
                            </Content>
                            <ProgressBar progress={top.progress} label={_("Animation progress")} />
                        </>
                    )
                    : (
                        <Title headingLevel="h3" size="lg">
                            {snapshot.stale ? _("Unknown") : _("No animation")}
                        </Title>
                    )}
            </CardBody>
        </Card>
    );
};

/** What the Play / Stop buttons act on. */
export interface AnimationRef { id: number; name: string }

/** Why Play / Stop are disabled (null when usable), and what they do. */
export interface AnimationControls {
    playBlocked: string | null;
    stopBlocked: string | null;
    onPlay: (animation: AnimationRef) => void;
    onStop: (animation: AnimationRef) => void;
}

const StopButton = ({ animation, controls }: { animation: AnimationRef; controls: AnimationControls }) => (
    <Button
        variant="secondary"
        isDanger
        size="sm"
        icon={<StopIcon />}
        isAriaDisabled={!!controls.stopBlocked}
        title={controls.stopBlocked ?? undefined}
        onClick={() => controls.onStop(animation)}
    >
        {_("Stop")}
    </Button>
);

export const LedStrips = ({ snapshot }: { snapshot: LedSnapshot }) => (
    <Card>
        <CardHeader>
            <CardTitle>{_("LED strips")}</CardTitle>
            <Content component="small">
                {snapshot.brightness == null
                    ? _("Colour × brightness sent to each LED")
                    : cockpit.format(_("Colour × brightness sent to each LED, at $0% global brightness"),
                                     Math.round(snapshot.brightness * 100))}
            </Content>
        </CardHeader>
        <CardBody>
            {snapshot.panels.map(panel => {
                const names = snapshot.segments.filter(segment => segment.channel === panel.channel).map(segment => segment.name);
                return (
                    <div className="led-strip" key={panel.channel}>
                        <Content component="small">
                            {cockpit.format(_("Channel $0"), panel.channel)}{names.length ? ` · ${names.join(", ")}` : ""}
                        </Content>
                        <div className="led-strip-leds" role="img" aria-label={cockpit.format(_("Channel $0 LED colours"), panel.channel)}>
                            {panel.leds
                                ? panel.leds.map((led, i) => (
                                    <span
                                        key={i}
                                        className="led-strip-led"
                                        style={{ "--led-color": ledColor(led, snapshot.brightness ?? 1) } as React.CSSProperties}
                                        title={`LED ${i}: rgba(${led.join(", ")})`}
                                    />
                                ))
                                : <Content component="small">{_("No frame received")}</Content>}
                        </div>
                    </div>
                );
            })}
        </CardBody>
    </Card>
);

export const LayerTable = ({ snapshot, controls }: { snapshot: LedSnapshot; controls: AnimationControls }) => (
    <Card>
        <CardHeader>
            <CardTitle>{_("Priority layers")}</CardTitle>
            <Content component="small">{_("Lower layers draw on top and blend with transparency")}</Content>
        </CardHeader>
        <CardBody>
            <Table variant="compact" aria-label={_("Priority layers")}>
                <Thead>
                    <Tr>
                        <Th>{_("Layer")}</Th>
                        <Th>{_("Animation")}</Th>
                        <Th>{_("Param")}</Th>
                        <Th>{_("Mode")}</Th>
                        <Th width={20}>{_("Progress")}</Th>
                        <Th>{_("Segments")}</Th>
                        <Th screenReaderText={_("Actions")} />
                    </Tr>
                </Thead>
                <Tbody>
                    {snapshot.layers.flatMap(layer => layer.animations.length === 0
                        ? [
                            <Tr key={layer.layer}>
                                <Td dataLabel={_("Layer")}><LayerLabel layer={layer.layer} /></Td>
                                <Td colSpan={6}>{snapshot.stale ? _("Unknown") : _("Idle")}</Td>
                            </Tr>
                        ]
                        : layer.animations.map(item => (
                            <Tr key={`${layer.layer}-${item.id}`}>
                                <Td dataLabel={_("Layer")}><LayerLabel layer={layer.layer} /></Td>
                                <Td dataLabel={_("Animation")}><strong>{item.name}</strong> #{item.id}</Td>
                                <Td dataLabel={_("Param")}>{item.param || "—"}</Td>
                                <Td dataLabel={_("Mode")}>
                                    {item.repeating ? _("Repeating") : _("One-shot")}
                                    {item.queued ? ` · ${cockpit.format(_("$0 queued"), item.queued)}` : ""}
                                </Td>
                                <Td dataLabel={_("Progress")}><ProgressBar progress={item.progress} label={cockpit.format(_("$0 progress"), item.name)} /></Td>
                                <Td dataLabel={_("Segments")}>{item.segments.join(", ")}</Td>
                                <Td isActionCell><StopButton animation={item} controls={controls} /></Td>
                            </Tr>
                        )))}
                </Tbody>
            </Table>
        </CardBody>
    </Card>
);

const StateLabel = ({ row }: { row: AnimationRow }) => {
    if (row.active) return <Label isCompact color="green">{_("Playing")}</Label>;
    if (row.configured === false) return <Label isCompact>{_("Not configured")}</Label>;
    if (row.configured === null) return <Label isCompact>{_("Unknown")}</Label>;
    return <Label isCompact variant="outline">{_("Idle")}</Label>;
};

export const AnimationTable = ({ snapshot, controls }: { snapshot: LedSnapshot; controls: AnimationControls }) => {
    const rows = snapshot.animations;
    const loaded = rows.filter(row => row.configured).length;
    return (
        <Card>
            <CardHeader>
                <CardTitle>{_("Animation table")}</CardTitle>
                <Content component="small">
                    {rows.some(row => row.configured === null)
                        ? _("Waiting for the animation list from rover_led_controller")
                        : cockpit.format(_("$0 of $1 loaded on this robot"), loaded, rows.length)}
                </Content>
            </CardHeader>
            <CardBody>
                <Table variant="compact" aria-label={_("Animation table")}>
                    <Thead>
                        <Tr>
                            <Th>{_("ID")}</Th>
                            <Th>{_("Name")}</Th>
                            <Th>{_("Priority")}</Th>
                            <Th>{_("Description")}</Th>
                            <Th>{_("State")}</Th>
                            <Th screenReaderText={_("Actions")} />
                        </Tr>
                    </Thead>
                    <Tbody>
                        {rows.map(row => (
                            <Tr key={row.id} className={row.configured === false ? "led-row-muted" : ""} isRowSelected={row.active}>
                                <Td dataLabel={_("ID")}>{row.id}</Td>
                                <Td dataLabel={_("Name")}><strong>{row.name}</strong></Td>
                                <Td dataLabel={_("Priority")}>{row.priority} <LayerLabel layer={row.layer} /></Td>
                                <Td dataLabel={_("Description")}>{row.description}</Td>
                                <Td dataLabel={_("State")}>
                                    <StateLabel row={row} />
                                    {row.active && row.segments.length > 0 && <Content component="small"> {row.segments.join(", ")}</Content>}
                                </Td>
                                <Td isActionCell>
                                    <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }}>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            icon={<PlayIcon />}
                                            isAriaDisabled={!!controls.playBlocked || row.configured === false}
                                            title={controls.playBlocked ?? (row.configured === false ? _("Not loaded on this robot") : undefined)}
                                            onClick={() => controls.onPlay(row)}
                                        >
                                            {_("Play")}
                                        </Button>
                                        {row.active && <StopButton animation={row} controls={controls} />}
                                    </Flex>
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            </CardBody>
        </Card>
    );
};
