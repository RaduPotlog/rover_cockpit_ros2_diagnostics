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

// Static SVG markup, ported from rover_network_monitor (public/icons.js).
// Packet-Tracer-style device glyphs, drawn around (0, 0). Each is roughly 64 × 44
// user units; labels are placed below by the caller (see LABEL_OFFSET).

export const LABEL_OFFSET = 32;

export const DEFS = `
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d4d4d4"/>
      <stop offset="1" stop-color="#6f6f6f"/>
    </linearGradient>
  </defs>`;

// Two inward arrows across the lid and two outward arrows along its short axis.
const ROUTER_ARROWS = `
  <path class="ico-mark" d="M-21 -8h9m-3 -3l3 3-3 3"/>
  <path class="ico-mark" d="M21 -8h-9m3 -3l-3 3 3 3"/>
  <path class="ico-mark" d="M0 -11v-4m-2.5 2.5l2.5-2.5 2.5 2.5"/>
  <path class="ico-mark" d="M0 -5v4m-2.5-2.5l2.5 2.5 2.5-2.5"/>`;

const routerPuck = (rx = 28): string => `
  <path class="ico-body" d="M${-rx} -8v14a${rx} 9 0 0 0 ${2 * rx} 0v-14Z"/>
  <ellipse class="ico-top" cx="0" cy="-8" rx="${rx}" ry="9"/>
  ${ROUTER_ARROWS}`;

const ICONS: Record<string, string> = {
    router: routerPuck(),

    'wireless-router': `
    <path class="ico-line" d="M-17 -12l-5 -22M17 -12l5 -22"/>
    <circle class="ico-dark" cx="-22" cy="-34" r="2.2"/>
    <circle class="ico-dark" cx="22" cy="-34" r="2.2"/>
    ${routerPuck(26)}`,

    switch: `
    <path class="ico-top" d="M-32 -3L-21 -13H33L22 -3Z"/>
    <path class="ico-body" d="M-32 -3H22V8H-32Z"/>
    <path class="ico-body" d="M22 -3L33 -13V-2L22 8Z" style="fill:#6f6f6f"/>
    <path class="ico-mark" d="M-17 -10h15m-3 -2l3 2-3 2"/>
    <path class="ico-mark" d="M9 -6h-15m3 -2l-3 2 3 2"/>
    ${Array.from({ length: 8 }, (_, i) => `<rect class="ico-dark" x="${-29 + i * 6.2}" y="1" width="4.2" height="3.2" rx=".6"/>`).join('')}`,

    pc: `
    <rect class="ico-body" x="-26" y="-25" width="36" height="28" rx="2.5"/>
    <rect class="ico-screen" x="-23" y="-22" width="30" height="21" rx="1"/>
    <path class="ico-glass" d="M-21 -20h26v17h-26Z"/>
    <path class="ico-dark" d="M-11 3h8l2.5 6h-13Z"/>
    <path class="ico-line" d="M-17 10h20"/>
    <rect class="ico-body" x="15" y="-23" width="13" height="33" rx="1.5"/>
    <path class="ico-line" d="M18 -18h7M18 -14h7" style="stroke-width:1.4"/>
    <circle class="ico-dark" cx="21.5" cy="4" r="1.6"/>`,

    // Rotating scanner: a squat puck with a dark window band and scan arcs fanning
    // out to both sides.
    lidar: `
    <path class="ico-mark" d="M-24 -14a12 12 0 0 0 0 16M-30 -18a18 18 0 0 0 0 24"/>
    <path class="ico-mark" d="M24 -14a12 12 0 0 1 0 16M30 -18a18 18 0 0 1 0 24"/>
    <path class="ico-body" d="M-18 -6v12a18 8 0 0 0 36 0V-6Z"/>
    <path class="ico-dark" d="M-18 -6v7a18 8 0 0 0 36 0V-6Z"/>
    <ellipse class="ico-top" cx="0" cy="-6" rx="18" ry="8"/>
    <ellipse class="ico-dark" cx="0" cy="-6" rx="6" ry="2.6"/>`,
};

export function deviceIcon(kind: string): string {
    return ICONS[kind] ?? ICONS.pc;
}
