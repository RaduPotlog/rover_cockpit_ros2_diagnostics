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
    ActionGroup,
    Alert,
    AlertActionCloseButton,
    Button,
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    Checkbox,
    Content,
    Flex,
    FlexItem,
    Grid,
    GridItem,
    Label,
    Progress,
    ProgressMeasureLocation,
    ProgressSize,
    ProgressStep,
    ProgressStepper,
    Stack,
    Title,
} from "@patternfly/react-core";

import cockpit from 'cockpit';
import { useRos } from '../components/RosProvider';
import { ChannelTable, LinkCard } from './RcViews';
import { useRcState } from './useRcState';
import {
    ESTOP_ENGAGED,
    ESTOP_RELEASED,
    PHASE_CENTER,
    PHASE_IDLE,
    PHASE_REVIEW,
    PHASE_SWEEP,
    canCalibrate,
    isCalibrating,
    type EStop,
    type RcReference,
} from './model';
import referenceJson from './rc_reference.json';

const _ = cockpit.gettext;

// Module constant: a stable identity, so the subscription effect never restarts on render.
const REFERENCE = referenceJson as RcReference;

const NODE = "rover_crsf_teleop_node";

// lifecycle_msgs/Transition
const TRANSITION_ACTIVATE = 3;
const TRANSITION_DEACTIVATE = 4;
// lifecycle_msgs/State
const STATE_ACTIVE = 3;

interface ServiceResult { success: boolean; message: string }
interface Feedback { variant: "success" | "danger" | "warning"; title: string; detail?: string }

/**
 * Why the calibration controls are unusable, or null when they can be used.
 *
 * Any logged-in Cockpit user may use them: rover-cockpit's account has no sudo, and
 * foxglove_bridge (port 8765) itself serves these services without authentication. The gates that
 * matter — the E-Stop confirmation and the node being inactive — are enforced by the node, not
 * here, so a client that skipped this page could not skip them either.
 */
const controlsBlockedReason = (connected: boolean, available: boolean): string | null => {
    if (!connected) return _("Not connected to foxglove_bridge");
    if (!available) return _("rover_crsf_teleop is not advertising its calibration services");
    return null;
};

/**
 * The rover's own answer, not the operator's. Start is enabled only on ENGAGED, and the node
 * enforces the same rule - this is the convenient path to it, not the only one.
 */
const EStopIndicator = ({ eStop }: { eStop: EStop }) => {
    if (eStop === ESTOP_ENGAGED) {
        return <Label color="green">{_("E-Stop engaged")}</Label>;
    }

    if (eStop === ESTOP_RELEASED) {
        return <Label color="red">{_("E-Stop released")}</Label>;
    }

    return (
        <Label color="grey" title={_("Nothing recent on hardware_interface/safety_status")}>
            {_("E-Stop not verified")}
        </Label>
    );
};

const STEPS = [
    { phase: PHASE_IDLE, title: _("Safety") },
    { phase: PHASE_CENTER, title: _("Centre") },
    { phase: PHASE_SWEEP, title: _("Sweep") },
    { phase: PHASE_REVIEW, title: _("Review") },
];

/** Live view of rover_crsf_teleop's RC input, plus the stick calibration flow. */
export const RcTab = ({ namespace, namespaceValid }: { namespace: string; namespaceValid: boolean }) => {
    const { ros, connected } = useRos();
    const snapshot = useRcState(namespaceValid ? namespace : "", REFERENCE);

    const [eStopConfirmed, setEStopConfirmed] = useState(false);
    const [persist, setPersist] = useState(true);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState<Feedback | null>(null);

    const startService = `${namespace}/rc/calibration/start`;
    const sweepService = `${namespace}/rc/calibration/sweep`;
    const finishService = `${namespace}/rc/calibration/finish`;
    const cancelService = `${namespace}/rc/calibration/cancel`;
    const applyService = `${namespace}/rc/calibration/apply`;
    const changeStateService = `${namespace}/${NODE}/change_state`;
    const getStateService = `${namespace}/${NODE}/get_state`;

    // Re-evaluated on every snapshot refresh, so a late advertisement shows up.
    const blocked = controlsBlockedReason(connected, !!ros?.hasService(startService));
    const lifecycleBlocked = controlsBlockedReason(connected, !!ros?.hasService(changeStateService));

    const call = async <Request, Response extends ServiceResult>(
        service: string, request: Request, what: string,
    ): Promise<Response | null> => {
        if (!ros) return null;
        setBusy(true);
        try {
            const result = await ros.callService<Request, Response>(service, request);
            setFeedback(result.success
                ? { variant: "success", title: what, ...(result.message ? { detail: result.message } : {}) }
                : { variant: "danger", title: cockpit.format(_("$0 was refused"), what), detail: result.message });
            return result;
        } catch (error) {
            setFeedback({
                variant: "danger",
                title: cockpit.format(_("$0 failed"), what),
                detail: String((error as Error)?.message ?? error),
            });
            return null;
        } finally {
            setBusy(false);
        }
    };

    /** Drives the node's lifecycle. Returns false when the transition did not take. */
    const transition = async (id: number, what: string): Promise<boolean> => {
        if (!ros) return false;
        setBusy(true);
        try {
            const result = await ros.callService<{ transition: { id: number; label: string } }, { success: boolean }>(
                changeStateService, { transition: { id, label: "" } });
            if (!result.success) {
                setFeedback({ variant: "danger", title: cockpit.format(_("$0 failed"), what) });
            }
            return result.success;
        } catch (error) {
            setFeedback({
                variant: "danger",
                title: cockpit.format(_("$0 failed"), what),
                detail: String((error as Error)?.message ?? error),
            });
            return false;
        } finally {
            setBusy(false);
        }
    };

    const nodeIsActive = async (): Promise<boolean> => {
        if (!ros) return false;
        try {
            const result = await ros.callService<Record<string, never>, { current_state: { id: number } }>(
                getStateService, {});
            return result.current_state?.id === STATE_ACTIVE;
        } catch {
            // Unknown is treated as "maybe active", so the deactivate below is attempted anyway.
            return true;
        }
    };

    const onStart = async () => {
        // The node refuses to calibrate while it is active, so take it off the command path
        // first. rc/channels keeps publishing while it is inactive - those are plain, not
        // lifecycle, publishers - so the measurement still works.
        if (await nodeIsActive()) {
            if (!await transition(TRANSITION_DEACTIVATE, _("Deactivating RC teleop"))) {
                return;
            }
        }
        await call(startService, { e_stop_confirmed: eStopConfirmed }, _("Start calibration"));
    };

    const onFinishSession = async (reactivate: boolean) => {
        if (reactivate) {
            await transition(TRANSITION_ACTIVATE, _("Reactivating RC teleop"));
        }
    };

    const onCancel = async () => {
        const result = await call(cancelService, {}, _("Cancel calibration"));
        if (result?.success) {
            await onFinishSession(true);
        }
    };

    const onApply = async () => {
        // An all-zero calibration is the node's "apply what you measured"; the page never second
        // guesses the measurement it was shown.
        const zeros = Array.from({ length: 16 }, () => 0);
        const result = await call(
            applyService,
            {
                calibration: {
                    channel_min: zeros, channel_mid: zeros, channel_max: zeros, channel_deadband: zeros,
                },
                persist,
            },
            _("Apply calibration"));

        if (result?.success) {
            await onFinishSession(true);
        }
    };

    const phase = snapshot.phase;
    const activeStep = STEPS.findIndex(step => step.phase === phase);

    let problem: string | null = null;
    if (!namespaceValid) problem = _("Set a valid ROS namespace to follow the RC receiver.");
    else if (!connected) problem = _("Not connected to foxglove_bridge. Retrying…");
    else if (!snapshot.everSeen) {
        problem = cockpit.format(
            _("Nothing on $0 yet. Is rover_crsf_teleop running, and publish_rc_topics on?"),
            `${namespace}/rc/channels`);
    } else if (snapshot.stale) problem = _("No RC frames right now — is the transmitter on and in range?");

    return (
        <Stack hasGutter>
            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem>
                    <Title headingLevel="h2" size="xl">{_("ROS 2 RC")}</Title>
                    <Content component="small">
                        {_("What the ExpressLRS transmitter is sending, as rover_crsf_teleop decodes it.")}
                    </Content>
                </FlexItem>
                <FlexItem>
                    {problem
                        ? <Label color="red">{_("No signal")}</Label>
                        : <Label color="green">{_("Live")}</Label>}
                </FlexItem>
            </Flex>
            {problem && <Alert variant="warning" isInline title={problem} />}
            {snapshot.teleopInhibited && snapshot.eStop !== ESTOP_ENGAGED && (
                <Alert
                    variant="danger"
                    isInline
                    title={_("The E-Stop is no longer engaged — this calibration is about to be cancelled.")}
                />
            )}
            {snapshot.teleopInhibited && (
                <Alert
                    variant="warning"
                    isInline
                    title={_("A calibration is running: RC teleop is held off until it finishes or is cancelled.")}
                >
                    {snapshot.message}
                </Alert>
            )}
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
                <GridItem md={7}>
                    <Card>
                        <CardHeader>
                            <CardTitle>{_("Stick calibration")}</CardTitle>
                            <Content component="small">
                                {blocked ?? _("Measures this transmitter's own centre and endpoints, per channel.")}
                            </Content>
                        </CardHeader>
                        <CardBody>
                            <Stack hasGutter>
                                <ProgressStepper isCenterAligned aria-label={_("Calibration steps")}>
                                    {STEPS.map((step, index) => (
                                        <ProgressStep
                                            key={step.title}
                                            id={`rc-step-${index}`}
                                            titleId={`rc-step-${index}-title`}
                                            variant={index === activeStep
                                                ? "info"
                                                : (activeStep > index || (activeStep === -1 && index === 0) ? "success" : "pending")}
                                        >
                                            {step.title}
                                        </ProgressStep>
                                    ))}
                                </ProgressStepper>

                                {phase === PHASE_IDLE && (
                                    <>
                                        <Content component="p">
                                            {_("The sweep drives the sticks to full throw, and RC teleop is not the only thing that can command this rover. Engage the E-Stop before starting; teleop is taken off the command path for the whole session and put back afterwards.")}
                                        </Content>
                                        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                                            <FlexItem><EStopIndicator eStop={snapshot.eStop} /></FlexItem>
                                            <FlexItem>
                                                <Content component="small">
                                                    {_("Read from the rover, not from the box below.")}
                                                </Content>
                                            </FlexItem>
                                        </Flex>
                                        {snapshot.eStop !== ESTOP_ENGAGED && (
                                            <Alert
                                                variant="info"
                                                isInline
                                                isPlain
                                                title={snapshot.eStop === ESTOP_RELEASED
                                                    ? _("Engage the E-Stop to enable calibration.")
                                                    : _("Cannot reach hardware_interface/safety_status. Calibration needs rover_hardware_interface running — it is refused rather than assumed safe.")}
                                            />
                                        )}
                                        <Checkbox
                                            id="rc-estop-confirmed"
                                            label={_("I have checked the E-Stop myself")}
                                            isChecked={eStopConfirmed}
                                            onChange={(_event, checked) => setEStopConfirmed(checked)}
                                        />
                                        <ActionGroup>
                                            <Button
                                                variant="primary"
                                                onClick={onStart}
                                                isLoading={busy}
                                                isAriaDisabled={!!blocked || !!lifecycleBlocked ||
                                                    !eStopConfirmed || !canCalibrate(snapshot.eStop) || busy}
                                                title={blocked ?? lifecycleBlocked ?? undefined}
                                            >
                                                {_("Start calibration")}
                                            </Button>
                                        </ActionGroup>
                                    </>
                                )}

                                {phase === PHASE_CENTER && (
                                    <>
                                        <Content component="p">
                                            {_("Let go of every stick and leave the transmitter alone.")}
                                        </Content>
                                        <Progress
                                            value={Math.round(snapshot.progress * 100)}
                                            size={ProgressSize.sm}
                                            measureLocation={ProgressMeasureLocation.outside}
                                            title={cockpit.format(_("$0 frames at rest"), snapshot.samples)}
                                            aria-label={_("Centre capture progress")}
                                        />
                                        <ActionGroup>
                                            <Button
                                                variant="primary"
                                                onClick={() => call(sweepService, {}, _("Begin sweep"))}
                                                isLoading={busy}
                                                isAriaDisabled={busy || snapshot.progress < 1}
                                            >
                                                {_("Sticks released, begin the sweep")}
                                            </Button>
                                            <Button variant="link" onClick={onCancel} isAriaDisabled={busy}>
                                                {_("Cancel")}
                                            </Button>
                                        </ActionGroup>
                                    </>
                                )}

                                {phase === PHASE_SWEEP && (
                                    <>
                                        <Content component="p">
                                            {_("Move every stick and switch slowly to both extremes, then back to the middle. Watch the ranges below fill in.")}
                                        </Content>
                                        <Content component="small">
                                            {cockpit.format(_("$0 frames recorded"), snapshot.samples)}
                                        </Content>
                                        <ActionGroup>
                                            <Button
                                                variant="primary"
                                                onClick={() => call(finishService, {}, _("Finish sweep"))}
                                                isLoading={busy}
                                                isAriaDisabled={busy}
                                            >
                                                {_("Done sweeping")}
                                            </Button>
                                            <Button variant="link" onClick={onCancel} isAriaDisabled={busy}>
                                                {_("Cancel")}
                                            </Button>
                                        </ActionGroup>
                                    </>
                                )}

                                {phase === PHASE_REVIEW && (
                                    <>
                                        <Content component="p">
                                            {_("Check the measured ranges below. Applying rebuilds the stick mapping straight away — nothing restarts.")}
                                        </Content>
                                        {snapshot.problems.map(problemText => (
                                            <Alert key={problemText} variant="warning" isInline isPlain title={problemText} />
                                        ))}
                                        <Checkbox
                                            id="rc-persist"
                                            label={_("Save it, so it survives a restart")}
                                            isChecked={persist}
                                            onChange={(_event, checked) => setPersist(checked)}
                                        />
                                        <ActionGroup>
                                            <Button
                                                variant="primary"
                                                onClick={onApply}
                                                isLoading={busy}
                                                isAriaDisabled={busy || snapshot.problems.length > 0}
                                                title={snapshot.problems.length > 0
                                                    ? _("Fix the problems above, or re-measure")
                                                    : undefined}
                                            >
                                                {_("Apply")}
                                            </Button>
                                            <Button variant="link" onClick={onCancel} isAriaDisabled={busy}>
                                                {_("Discard")}
                                            </Button>
                                        </ActionGroup>
                                    </>
                                )}
                            </Stack>
                        </CardBody>
                    </Card>
                </GridItem>
                <GridItem md={5}>
                    <LinkCard snapshot={snapshot} />
                </GridItem>
            </Grid>
            <ChannelTable snapshot={snapshot} />
            {isCalibrating(phase) && (
                <Content component="small">
                    {_("While a calibration runs, the min · centre · max column shows the measurement in progress, not the values in effect.")}
                </Content>
            )}
        </Stack>
    );
};
