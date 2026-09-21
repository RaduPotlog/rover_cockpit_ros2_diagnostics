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

/*
 * Plain-language meaning for boolean diagnostic values whose True/False is easy to misread.
 *
 * The safety pins arrive as raw True/False, and the polarity is not obvious from the name alone:
 * "HW E-Stop user button: False" reads as "the E-Stop is off" to some people and "the button is
 * not working" to others. This spells out what each level means physically, next to the raw
 * value rather than instead of it, so the value stays copyable into a bug report.
 *
 * Keys are the exact strings rover_twist_mux's "Motion lock" diagnostic publishes (see
 * rover_twist_mux/src/infrastructure/motion_lock_node.cpp, diagnoseMotionLock()). A key that is
 * renamed there simply loses its label here - it never gets a wrong one.
 */

interface BooleanMeaning {
    whenTrue: string;
    whenFalse: string;
}

const BOOLEAN_MEANINGS: Readonly<Record<string, BooleanMeaning>> = {
    // Physical mushroom button on the rover, read from the PLC's discrete input.
    'HW E-Stop user button': { whenTrue: 'PRESSED', whenFalse: 'RELEASED' },
    // The software E-Stop request (RC switch, rover_safety, service call).
    'SW E-Stop user button': { whenTrue: 'PRESSED', whenFalse: 'RELEASED' },
    // The PLC's E-Stop latch, set by any of its trip sources and held until an explicit reset.
    'SW E-Stop latch status': { whenTrue: 'ON', whenFalse: 'OFF' },
};

/**
 * The physical meaning of a diagnostic value, or null when the key has none or the value is not a
 * recognisable boolean (so nothing is ever labelled on a guess).
 */
export function booleanMeaning(key: string, value: string): string | null {
    const meaning = BOOLEAN_MEANINGS[key];

    if (!meaning) {
        return null;
    }

    switch (value.trim().toLowerCase()) {
    case 'true':
        return meaning.whenTrue;
    case 'false':
        return meaning.whenFalse;
    default:
        return null;
    }
}
