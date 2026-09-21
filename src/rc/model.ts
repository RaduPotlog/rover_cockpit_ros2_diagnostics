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

/*
 * RC receiver state, as rover_crsf_teleop reports it.
 *
 * The node decodes CRSF from the ExpressLRS receiver and echoes every frame on
 * <ns>/rc/channels (16 raw 11-bit counts, ~50 Hz, best effort) with link quality on
 * <ns>/rc/link. <ns>/rc/calibration/state carries the per-channel calibration in
 * effect plus any calibration session in progress; it is transient-local, so it
 * arrives as soon as the page subscribes.
 *
 * Deflection is expressed about each channel's *calibrated* centre rather than the
 * nominal 992, because that is what the rover actually maps sticks with: on this
 * transmitter ch3 rests at 1004 and ch1 at 987.
 *
 * Pure: no cockpit, React or DOM imports, so it runs under `node --test`.
 */

export const CHANNEL_COUNT = 16;

/** No frame for this long and the receiver is presumed silent, not merely quiet. */
export const STALE_MS = 1000;

/** Phases of rover_crsf_teleop's calibration, matching RcCalibrationState's constants. */
export const PHASE_IDLE = 0;
export const PHASE_CENTER = 1;
export const PHASE_SWEEP = 2;
export const PHASE_REVIEW = 3;

export type Phase = typeof PHASE_IDLE | typeof PHASE_CENTER | typeof PHASE_SWEEP | typeof PHASE_REVIEW;

/**
 * What the node verified about the rover's E-Stop, from hardware_interface/safety_status. This is
 * what actually gates a calibration; the operator's tick is a second, independent condition.
 *
 * UNKNOWN is not "probably fine" - nothing has been received, or the sample is too old to trust -
 * and the node refuses a calibration in that state, so the page does too.
 */
export const ESTOP_UNKNOWN = 0;
export const ESTOP_ENGAGED = 1;
export const ESTOP_RELEASED = 2;

export type EStop = typeof ESTOP_UNKNOWN | typeof ESTOP_ENGAGED | typeof ESTOP_RELEASED;

// Field names follow the rover_msgs definitions, as decoded from CDR.
export interface RcChannelsMsg { channels: number[] | Uint16Array }

export interface RcLinkStatusMsg {
    uplink_rssi_ant1: number;
    uplink_rssi_ant2: number;
    uplink_link_quality: number;
    uplink_snr: number;
    active_antenna: number;
    rf_mode: number;
    uplink_tx_power: number;
    downlink_rssi: number;
    downlink_link_quality: number;
    downlink_snr: number;
}

export interface RcCalibrationMsg {
    channel_min: number[] | Uint16Array;
    channel_mid: number[] | Uint16Array;
    channel_max: number[] | Uint16Array;
    channel_deadband: number[] | Uint16Array;
}

export interface RcCalibrationStateMsg {
    phase: number;
    e_stop?: number;
    samples: number;
    progress: number;
    teleop_inhibited: boolean;
    active: RcCalibrationMsg;
    measured: RcCalibrationMsg;
    channel_moved: boolean[] | Uint8Array;
    problems: string[];
    message: string;
}

export interface ReferenceChannel {
    channel: number;
    role: string | null;
    label: string;
    description: string;
}
export interface RcReference { channels: ReferenceChannel[] }

export interface Calibration { min: number; mid: number; max: number; deadband: number }

export interface ChannelRow {
    channel: number;
    label: string;
    role: string | null;
    description: string;
    /** Raw 11-bit count, or null before the first frame. */
    raw: number | null;
    /** -1 … 1 about the calibrated centre, 0 inside the deadband. null without a frame. */
    deflection: number | null;
    calibration: Calibration;
    /** The live measurement, while a calibration is running. */
    measured: Calibration | null;
    moved: boolean;
}

export interface RcInputs {
    channels: RcChannelsMsg | null;
    channelsAt: number | null;
    link: RcLinkStatusMsg | null;
    linkAt: number | null;
    calibration: RcCalibrationStateMsg | null;
}

export interface RcSnapshot {
    /** No RC frame within STALE_MS. */
    stale: boolean;
    /** Nothing has ever arrived — the page has just opened, or the node is not running. */
    everSeen: boolean;
    rows: ChannelRow[];
    link: RcLinkStatusMsg | null;
    linkStale: boolean;
    phase: Phase;
    samples: number;
    progress: number;
    teleopInhibited: boolean;
    eStop: EStop;
    problems: string[];
    message: string;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

const at = (values: number[] | Uint16Array | boolean[] | Uint8Array | undefined, index: number) =>
    (values && index < values.length) ? values[index] : undefined;

const NOMINAL: Calibration = { min: 172, mid: 992, max: 1811, deadband: 30 };

/** One channel's calibration out of an RcCalibration message, falling back to the CRSF nominals. */
export const calibrationAt = (message: RcCalibrationMsg | null | undefined, index: number): Calibration => {
    const min = at(message?.channel_min, index);
    const mid = at(message?.channel_mid, index);
    const max = at(message?.channel_max, index);
    const deadband = at(message?.channel_deadband, index);

    if (min === undefined || mid === undefined || max === undefined || deadband === undefined) {
        return NOMINAL;
    }

    return { min: Number(min), mid: Number(mid), max: Number(max), deadband: Number(deadband) };
};

/**
 * Raw count to -1 … 1 about the calibrated centre.
 *
 * Deliberately the same shape as the rover's own mapAxis (domain/stick_mapping.cpp): each half of
 * the throw is normalised independently, so an asymmetric range — the norm once a transmitter has
 * been trimmed — still reaches ±1 without shifting the centre off zero. A degenerate calibration
 * returns 0 rather than dividing by a non-positive span.
 */
export const deflectionOf = (raw: number, calibration: Calibration): number => {
    const { min, mid, max, deadband } = calibration;
    const clamped = clamp(raw, min, max);
    const offset = clamped - mid;

    if (Math.abs(offset) <= deadband) {
        return 0;
    }

    const halfSpan = offset > 0 ? (max - mid - deadband) : (mid - min - deadband);
    if (halfSpan <= 0) {
        return 0;
    }

    const magnitude = (Math.abs(offset) - deadband) / halfSpan;
    return offset > 0 ? Math.min(1, magnitude) : -Math.min(1, magnitude);
};

const asEStop = (value: number | undefined): EStop =>
    (value === ESTOP_ENGAGED || value === ESTOP_RELEASED) ? value : ESTOP_UNKNOWN;

/** Whether the rover itself says it is safe to sweep the sticks to full throw. */
export const canCalibrate = (eStop: EStop) => eStop === ESTOP_ENGAGED;

/** True while the calibration flow owns the sticks. */
export const isCalibrating = (phase: Phase) => phase !== PHASE_IDLE;

export const rcSnapshot = (inputs: RcInputs, reference: RcReference, now: number): RcSnapshot => {
    const calibrationState = inputs.calibration;
    const phase = (calibrationState?.phase ?? PHASE_IDLE) as Phase;
    // The measurement is only meaningful once a session has started; at idle the "measured"
    // arrays are whatever the last session left behind.
    const showMeasured = isCalibrating(phase);

    const rows: ChannelRow[] = reference.channels.map((entry, index) => {
        const raw = at(inputs.channels?.channels, index);
        const rawValue = raw === undefined ? null : Number(raw);
        const calibration = calibrationAt(calibrationState?.active, index);

        return {
            channel: entry.channel,
            label: entry.label,
            role: entry.role,
            description: entry.description,
            raw: rawValue,
            deflection: rawValue === null ? null : deflectionOf(rawValue, calibration),
            calibration,
            measured: showMeasured ? calibrationAt(calibrationState?.measured, index) : null,
            moved: Boolean(at(calibrationState?.channel_moved, index)),
        };
    });

    return {
        stale: inputs.channelsAt === null || (now - inputs.channelsAt) > STALE_MS,
        everSeen: inputs.channelsAt !== null,
        rows,
        link: inputs.link,
        linkStale: inputs.linkAt === null || (now - inputs.linkAt) > STALE_MS * 5,
        phase,
        samples: calibrationState?.samples ?? 0,
        progress: calibrationState?.progress ?? 0,
        teleopInhibited: calibrationState?.teleop_inhibited ?? false,
        // A missing field reads as UNKNOWN, never as engaged: an older node that does not
        // publish it must not look like one that has verified the E-Stop.
        eStop: asEStop(calibrationState?.e_stop),
        problems: calibrationState?.problems ?? [],
        message: calibrationState?.message ?? "",
    };
};

/** ELRS reports RSSI as a positive number of dBm below zero. */
export const rssiDbm = (value: number) => -value;

export const RF_MODES: Readonly<Record<number, string>> = { 0: "4 Hz", 1: "50 Hz", 2: "150 Hz" };

export const TX_POWERS: Readonly<Record<number, string>> = {
    0: "0 mW", 1: "10 mW", 2: "25 mW", 3: "100 mW", 4: "500 mW", 5: "1 W", 6: "2 W",
};

/**
 * Link quality against rover_crsf_teleop's own failsafe thresholds, so the colour on the page
 * means the same thing as the rover's decision to stop driving.
 */
export const linkQualityVariant = (
    quality: number, lostBelow = 30, recoveredAt = 50,
): "success" | "warning" | "danger" => {
    if (quality < lostBelow) return "danger";
    if (quality < recoveredAt) return "warning";
    return "success";
};
