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

import React from 'react';

import {
    Card,
    CardBody,
    CardHeader,
    CardTitle,
    Content,
    DescriptionList,
    DescriptionListDescription,
    DescriptionListGroup,
    DescriptionListTerm,
    Label,
} from "@patternfly/react-core";

import cockpit from 'cockpit';
import {
    RF_MODES,
    TX_POWERS,
    linkQualityVariant,
    rssiDbm,
    type ChannelRow,
    type RcSnapshot,
} from './model';

const _ = cockpit.gettext;

const ROLE_COLOR: Record<string, "blue" | "orange" | "red" | "purple"> = {
    linear_x: "blue",
    angular_z: "blue",
    e_stop: "red",
    latch_reset: "orange",
};

const ROLE_LABEL: Record<string, string> = {
    linear_x: "linear.x",
    angular_z: "angular.z",
    e_stop: "E-Stop",
    latch_reset: "latch reset",
};

/**
 * One channel drawn centre-out: a tick at the calibrated centre and a bar growing left or right
 * by the deflection. Centre-out rather than left-to-right because that is how the rover reads the
 * channel — the thing worth seeing at a glance is whether a released stick sits exactly on zero.
 */
const ChannelBar = ({ row }: { row: ChannelRow }) => {
    const deflection = row.deflection ?? 0;
    const width = Math.abs(deflection) * 50;
    const left = deflection >= 0 ? 50 : 50 - width;

    return (
        <div className="rc-bar" role="img" aria-label={cockpit.format(_("Channel $0 at $1%"), row.channel, Math.round(deflection * 100))}>
            <div className="rc-bar-track">
                {row.raw !== null && (
                    <div
                        className={deflection === 0 ? "rc-bar-fill rc-bar-fill-centred" : "rc-bar-fill"}
                        style={{ insetInlineStart: `${left}%`, inlineSize: `${Math.max(width, 0.6)}%` }}
                    />
                )}
                <div className="rc-bar-centre" />
            </div>
        </div>
    );
};

const RangeText = ({ row }: { row: ChannelRow }) => {
    // While a sweep is running, show what it has captured so far rather than what is in effect:
    // watching min and max spread out is how an operator knows the channel has been swept.
    const range = row.measured ?? row.calibration;

    return (
        <Content component="small" className="rc-range">
            {range.min} · <strong>{range.mid}</strong> · {range.max}
            {" "}
            <span className="rc-range-deadband">{cockpit.format(_("±$0"), range.deadband)}</span>
        </Content>
    );
};

export const ChannelTable = ({ snapshot }: { snapshot: RcSnapshot }) => (
    <Card>
        <CardHeader>
            <CardTitle>{_("RC channels")}</CardTitle>
            <Content component="small">
                {_("Raw 11-bit counts from the receiver, and where each one sits between its calibrated endpoints. Channel N is channels[N-1].")}
            </Content>
        </CardHeader>
        <CardBody>
            <table className="rc-table">
                <thead>
                    <tr>
                        <th scope="col">{_("Ch")}</th>
                        <th scope="col">{_("Role")}</th>
                        <th scope="col" className="rc-col-bar">{_("Position")}</th>
                        <th scope="col" className="rc-col-raw">{_("Raw")}</th>
                        <th scope="col">{_("min · centre · max")}</th>
                    </tr>
                </thead>
                <tbody>
                    {snapshot.rows.map(row => (
                        <tr key={row.channel} className={row.role ? undefined : "rc-row-muted"}>
                            <th scope="row">{row.channel}</th>
                            <td>
                                {row.role
                                    ? <Label isCompact color={ROLE_COLOR[row.role] ?? "grey"}>{ROLE_LABEL[row.role] ?? row.role}</Label>
                                    : <Content component="small">{_("unassigned")}</Content>}
                            </td>
                            <td className="rc-col-bar"><ChannelBar row={row} /></td>
                            <td className="rc-col-raw">{row.raw === null ? "—" : row.raw}</td>
                            <td><RangeText row={row} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </CardBody>
    </Card>
);

export const LinkCard = ({ snapshot }: { snapshot: RcSnapshot }) => {
    const link = snapshot.link;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{_("RC link")}</CardTitle>
                <Content component="small">
                    {_("Uplink is the half that carries the sticks; its link quality is what gates teleop.")}
                </Content>
            </CardHeader>
            <CardBody>
                {(!link || snapshot.linkStale)
                    ? (
                        <Content component="p">
                            {link
                                ? _("No recent link statistics — the receiver has gone quiet.")
                                : _("No link statistics yet.")}
                        </Content>
                    )
                    : (
                        <DescriptionList isHorizontal isCompact>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Uplink quality")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    <Label
isCompact color={linkQualityVariant(link.uplink_link_quality) === "success"
    ? "green"
    : linkQualityVariant(link.uplink_link_quality) === "warning" ? "orange" : "red"}
                                    >
                                        {link.uplink_link_quality} %
                                    </Label>
                                </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Uplink RSSI")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    {cockpit.format(_("$0 / $1 dBm (antenna $2)"),
                                                    rssiDbm(link.uplink_rssi_ant1), rssiDbm(link.uplink_rssi_ant2),
                                                    link.active_antenna + 1)}
                                </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Uplink SNR")}</DescriptionListTerm>
                                <DescriptionListDescription>{link.uplink_snr} dB</DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("RF mode / power")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    {RF_MODES[link.rf_mode] ?? link.rf_mode}
                                    {" · "}
                                    {TX_POWERS[link.uplink_tx_power] ?? link.uplink_tx_power}
                                </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Downlink")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    {cockpit.format(_("$0 % · $1 dBm · $2 dB"),
                                                    link.downlink_link_quality, rssiDbm(link.downlink_rssi),
                                                    link.downlink_snr)}
                                </DescriptionListDescription>
                            </DescriptionListGroup>
                        </DescriptionList>
                    )}
            </CardBody>
        </Card>
    );
};
