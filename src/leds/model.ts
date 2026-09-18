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
 * LED animation status, ported from rover_network_monitor (webserver/src/led.js).
 *
 * rover_led_controller publishes the loaded animations once on <ns>/led/animations
 * (latched), what every priority layer plays on <ns>/led/state (5 Hz) and one RGBA
 * frame per panel on <ns>/led/channel_<n>_frame (50 Hz), in wire order with one image row
 * per serpentine row of the panel. rover_led_driver reports the
 * global brightness it applies on <ns>/led/brightness (latched). The snapshot merges that
 * with the Husarion reference table so animations the robot has not loaded still
 * show up, marked as not configured.
 *
 * Pure: no cockpit, React or DOM imports, so it runs under `node --test`.
 */

export const STALE_MS = 2000;

export type Rgba = [number, number, number, number];

// Field names follow the rover_msgs definitions (as decoded from CDR).
export interface LedLayerStateMsg {
    priority: number;
    active: boolean;
    id: number;
    name: string;
    param: string;
    repeating: boolean;
    progress: number;
    queued: number;
}
export interface LedSegmentStateMsg { name: string; channel: number; layers: LedLayerStateMsg[] }
export interface LedStateMsg { segments: LedSegmentStateMsg[] }
export interface LedAnimationInfoMsg { id: number; name: string; priority: number }

export interface ReferenceAnimation { id: number; name: string; priority: number; description: string }
export interface LedReference { layers: string[]; animations: ReferenceAnimation[] }

export interface ActiveAnimation {
    id: number;
    name: string;
    param: string;
    repeating: boolean;
    progress: number;
    queued: number;
    segments: string[];
}

export interface LayerRow { priority: number; layer: string; animations: ActiveAnimation[] }

export interface AnimationRow {
    id: number;
    name: string;
    priority: number;
    layer: string | null;
    description: string;
    configured: boolean | null; // null until the catalog arrives: "unknown", not "missing"
    active: boolean;
    segments: string[];
}

export interface LedInputs {
    catalog: LedAnimationInfoMsg[] | null;
    state: LedStateMsg | null;
    stateAt: number | null;
    frames: Map<number, { leds: Rgba[]; rows: number; at: number } | null>;
    brightness: number | null;
}

export interface LedSnapshot {
    stale: boolean;
    updatedAt: number | null;
    top: (ActiveAnimation & { priority: number; layer: string }) | null;
    layers: LayerRow[];
    segments: { name: string; channel: number }[];
    animations: AnimationRow[];
    panels: { channel: number; leds: Rgba[] | null; rows: number }[];
    brightness: number | null; // null until rover_led_driver reports it
}

const fresh = (at: number | null | undefined, now: number, staleMs: number) =>
    at != null && now - at <= staleMs;

/** Animations playing on one layer, merged across the segments they cover. */
export const activeOnLayer = (segments: LedSegmentStateMsg[], priority: number): ActiveAnimation[] => {
    const byId = new Map<number, ActiveAnimation>();
    for (const segment of segments) {
        const layer = segment.layers.find(item => item.priority === priority);
        if (!layer?.active) continue;
        const entry = byId.get(layer.id) ?? {
            id: layer.id,
            name: layer.name,
            param: layer.param,
            repeating: layer.repeating,
            progress: layer.progress,
            queued: layer.queued,
            segments: [],
        };
        entry.segments.push(segment.name);
        entry.queued = Math.max(entry.queued, layer.queued);
        byId.set(layer.id, entry);
    }
    return [...byId.values()];
};

/** sensor_msgs/Image (rgba8) → [[r, g, b, a], …]; the CDR reader yields uint8[] as a Uint8Array. */
export const decodeRgba = (msg: { data?: ArrayLike<number> }): Rgba[] => {
    const bytes = msg.data ?? [];
    const leds: Rgba[] = [];
    for (let i = 0; i + 3 < bytes.length; i += 4) {
        leds.push([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    }
    return leds;
};

export interface PanelLed { index: number; led: Rgba }

/** Which end of the drawn panel LED 0 is on, as seen standing at that bumper. */
export type Led0Side = "left" | "right";

/**
 * A panel's LEDs in the order they are drawn, one array per physical row. A straight
 * strip (rows = 1) is one row with LED 0 on the left. A strip folded into serpentine rows
 * starts at LED 0 on led0Side and each following row turns back: the front (seen from
 * the front, LED 0 left) is 0 … 19 over 39 … 20, the rear (seen from behind, LED 0
 * right) is 19 … 0 over 20 … 39.
 */
export const panelRows = (leds: Rgba[], rows: number, led0Side: Led0Side = "left"): PanelLed[][] => {
    const all = leds.map((led, index) => ({ index, led }));
    if (rows <= 1 || leds.length % rows !== 0) return [all];
    const perRow = leds.length / rows;
    return [...Array(rows).keys()].map(row => {
        const part = all.slice(row * perRow, (row + 1) * perRow);
        // Even rows run away from LED 0's side, odd rows turn back towards it.
        return (row % 2 === 0) === (led0Side === "right") ? part.reverse() : part;
    });
};

/**
 * CSS colour an LED shows: the alpha channel is its brightness, scaled by the driver's
 * global brightness (see rover_led's SK9822 encoder). The frames are the controller's,
 * before the driver, so the global brightness is applied here.
 */
export const ledColor = ([r, g, b, a]: Rgba, brightness = 1) => {
    const scale = (a / 255) * Math.min(Math.max(brightness, 0), 1);
    return `rgb(${Math.round(r * scale)} ${Math.round(g * scale)} ${Math.round(b * scale)})`;
};

export const animationRows = (
    reference: LedReference,
    catalog: LedAnimationInfoMsg[] | null,
    layers: LayerRow[],
): AnimationRow[] => {
    const loaded = catalog ? new Map(catalog.map(item => [item.id, item])) : null;
    const known = new Map(reference.animations.map(item => [item.id, item]));
    const ids = [...new Set([...known.keys(), ...(loaded?.keys() ?? [])])].sort((a, b) => a - b);
    const playing = new Map(layers.flatMap(layer => layer.animations.map(item => [item.id, item] as const)));

    return ids.map(id => {
        const ref = known.get(id);
        // Every id comes from one of the two maps.
        const item = (loaded?.get(id) ?? ref) as LedAnimationInfoMsg;
        return {
            id,
            name: item.name,
            priority: item.priority,
            layer: reference.layers[item.priority] ?? null,
            description: ref?.description ?? "",
            configured: loaded ? loaded.has(id) : null,
            active: playing.has(id),
            segments: playing.get(id)?.segments ?? [],
        };
    });
};

export const ledSnapshot = (
    inputs: LedInputs,
    reference: LedReference,
    now: number,
    staleMs = STALE_MS,
): LedSnapshot => {
    // Never report old data as current: a stale state means "unknown".
    const segments = inputs.state && fresh(inputs.stateAt, now, staleMs) ? inputs.state.segments : null;
    const layers = reference.layers.map((layer, priority) => ({
        priority, layer, animations: segments ? activeOnLayer(segments, priority) : [],
    }));
    const top = layers.find(layer => layer.animations.length > 0);

    return {
        stale: segments == null,
        updatedAt: inputs.stateAt,
        top: top ? { ...top.animations[0], priority: top.priority, layer: top.layer } : null,
        layers,
        segments: segments?.map(({ name, channel }) => ({ name, channel })) ?? [],
        animations: animationRows(reference, inputs.catalog, layers),
        panels: [...inputs.frames].map(([channel, frame]) => ({
            channel,
            leds: frame && fresh(frame.at, now, staleMs) ? frame.leds : null,
            rows: frame?.rows ?? 1,
        })),
        brightness: inputs.brightness,
    };
};
