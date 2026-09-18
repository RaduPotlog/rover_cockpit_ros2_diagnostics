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
    ActionGroup,
    Alert,
    AlertActionCloseButton,
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    Content,
    Flex,
    FlexItem,
    Form,
    FormGroup,
    Grid,
    GridItem,
    Label,
    Slider,
    Stack,
    Switch,
    TextInput,
    Title,
} from "@patternfly/react-core";

import cockpit from 'cockpit';
import { useRos } from '../components/RosProvider';
import { AnimationTable, LayerTable, LedStrips, NowPlaying } from './LedViews';
import { useLedState } from './useLedState';
import type { AnimationRow, LedReference } from './model';
import referenceJson from './led_reference.json';

const _ = cockpit.gettext;

// Module constants: stable identities, so the subscription effect never restarts on render.
const REFERENCE = referenceJson as LedReference;
const CHANNELS = [1, 2] as const;

interface ServiceResult { success: boolean; message: string }
interface Feedback { variant: "success" | "danger"; title: string; detail?: string }

/**
 * Why the LED controls are disabled, or null when they can be used.
 * Any logged-in Cockpit user may use them: rover-cockpit's account has no sudo, and
 * foxglove_bridge (port 8765) itself serves these services without authentication.
 */
const controlsBlockedReason = (connected: boolean, available: boolean): string | null => {
    if (!connected) return _("Not connected to foxglove_bridge");
    if (!available) return _("rover_led services are not advertised on the bridge");
    return null;
};

/** Live view of rover_led (port of the rover_network_monitor LED page) plus controls. */
export const LedsTab = ({ namespace, namespaceValid }: { namespace: string; namespaceValid: boolean }) => {
    const { ros, connected } = useRos();
    const snapshot = useLedState(namespaceValid ? namespace : "", REFERENCE, CHANNELS);

    const [repeating, setRepeating] = useState(true);
    const [param, setParam] = useState("");
    const [brightness, setBrightness] = useState(1);
    const [lastBrightness, setLastBrightness] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback | null>(null);

    const animationService = `${namespace}/led/set_animation`;
    const brightnessService = `${namespace}/led/set_brightness`;
    // Re-evaluated on every snapshot refresh, so late advertisements show up.
    const animationBlocked = controlsBlockedReason(connected, !!ros?.hasService(animationService));
    const brightnessBlocked = controlsBlockedReason(connected, !!ros?.hasService(brightnessService));

    const call = async <Request, >(service: string, request: Request, what: string) => {
        if (!ros) return false;
        setBusy(true);
        try {
            const result = await ros.callService<Request, ServiceResult>(service, request);
            setFeedback(result.success
                ? { variant: "success", title: what, ...(result.message ? { detail: result.message } : {}) }
                : { variant: "danger", title: cockpit.format(_("$0 was rejected"), what), detail: result.message });
            return result.success;
        } catch (error) {
            setFeedback({ variant: "danger", title: cockpit.format(_("$0 failed"), what), detail: String((error as Error)?.message ?? error) });
            return false;
        } finally {
            setBusy(false);
        }
    };

    const play = (row: AnimationRow) => call(
        animationService,
        { animation: { id: row.id, param }, repeating },
        cockpit.format(_("Play $0"), row.name),
    );

    const applyBrightness = async () => {
        if (await call(brightnessService, { data: brightness }, cockpit.format(_("Set brightness to $0%"), Math.round(brightness * 100)))) {
            setLastBrightness(brightness);
        }
    };

    let problem: string | null = null;
    if (!namespaceValid) problem = _("Set a valid ROS namespace to follow rover_led.");
    else if (!connected) problem = _("Not connected to foxglove_bridge. Retrying…");
    else if (snapshot.stale) problem = cockpit.format(_("No LED state from rover_led_controller ($0). Is rover_led running?"), `${namespace}/led/state`);

    return (
        <Stack hasGutter>
            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem>
                    <Title headingLevel="h2" size="xl">{_("ROS 2 LEDs")}</Title>
                    <Content component="small">
                        {_("Animations played by rover_led on the bumper lights, following the ")}
                        <a href={(REFERENCE as { source?: string }).source} target="_blank" rel="noopener noreferrer">
                            {_("Husarion LED animation table")}
                        </a>.
                    </Content>
                </FlexItem>
                <FlexItem>
                    {problem
                        ? <Label color="red">{_("Disconnected")}</Label>
                        : <Label color="green">{_("Live")}</Label>}
                </FlexItem>
            </Flex>
            {problem && <Alert variant="warning" isInline title={problem} />}
            {feedback && (
                <Alert
                    variant={feedback.variant}
                    isInline
                    title={feedback.title}
                    actionClose={<AlertActionCloseButton onClose={() => setFeedback(null)} />}
                >
                    {feedback.detail}
                </Alert>
            )}
            <Grid hasGutter>
                <GridItem md={5}>
                    <NowPlaying snapshot={snapshot} />
                </GridItem>
                <GridItem md={7}>
                    <Card>
                        <CardHeader>
                            <CardTitle>{_("Controls")}</CardTitle>
                            <Content component="small">
                                {animationBlocked ?? _("Play an animation from the table below, or change the brightness.")}
                            </Content>
                        </CardHeader>
                        <CardBody>
                            <Form isHorizontal onSubmit={event => event.preventDefault()}>
                                <FormGroup label={_("Play mode")} fieldId="led-repeating">
                                    <Switch
                                        id="led-repeating"
                                        label={_("Repeating")}
                                        isChecked={repeating}
                                        onChange={(_event, checked) => setRepeating(checked)}
                                    />
                                </FormGroup>
                                <FormGroup label={_("Param")} fieldId="led-param">
                                    <TextInput
                                        id="led-param"
                                        value={param}
                                        onChange={(_event, value) => setParam(value)}
                                        placeholder={_("Optional, e.g. the charge level for CHARGING_BATTERY")}
                                    />
                                </FormGroup>
                                <FormGroup
                                    label={lastBrightness == null
                                        ? _("Brightness")
                                        : cockpit.format(_("Brightness (last set $0%)"), Math.round(lastBrightness * 100))}
                                    fieldId="led-brightness"
                                >
                                    <Slider
                                        id="led-brightness"
                                        value={Math.round(brightness * 100)}
                                        min={0}
                                        max={100}
                                        step={5}
                                        showBoundaries={false}
                                        showTicks={false}
                                        onChange={(_event, value) => setBrightness(value / 100)}
                                        isDisabled={!!brightnessBlocked}
                                        inputLabel="%"
                                        isInputVisible
                                        inputValue={Math.round(brightness * 100)}
                                        aria-label={_("Brightness")}
                                    />
                                </FormGroup>
                                <ActionGroup>
                                    <Button
                                        variant="primary"
                                        onClick={applyBrightness}
                                        isAriaDisabled={!!brightnessBlocked || busy}
                                        isLoading={busy}
                                        title={brightnessBlocked ?? undefined}
                                    >
                                        {_("Set brightness")}
                                    </Button>
                                </ActionGroup>
                            </Form>
                        </CardBody>
                    </Card>
                </GridItem>
            </Grid>
            <LedStrips snapshot={snapshot} />
            <LayerTable snapshot={snapshot} />
            <AnimationTable
                snapshot={snapshot}
                canPlay={!animationBlocked && !busy}
                playDisabledReason={animationBlocked}
                onPlay={play}
            />
        </Stack>
    );
};
