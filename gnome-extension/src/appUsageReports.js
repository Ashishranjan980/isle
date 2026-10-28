// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// The stretches waiting to go to isled, apart from GNOME: merge those of one app that touch, and drop
// flicks too short to be a row. `node --test` checks it; appUsage.js sends them once a minute.

/** Stretches buffered for the next report; `minMs` is the shortest worth keeping. */
export class AppUsageReports {
    constructor(minMs = 1000) {
        this._minMs = minMs;
        this._stretches = [];
    }

    /** Adds a stretch ({id, name, start, ms}), merging it with the last when the same app goes on. */
    add(stretch) {
        if (!stretch || stretch.ms < this._minMs)
            return;
        const last = this._stretches.at(-1);
        if (last && last.id === stretch.id && last.name === stretch.name &&
            last.start + last.ms === stretch.start) {
            last.ms += stretch.ms;
            return;
        }
        this._stretches.push({...stretch});
    }

    /** Takes everything buffered, oldest first; the buffer starts empty. */
    take() {
        const stretches = this._stretches;
        this._stretches = [];
        return stretches;
    }

    /** Forgets what is buffered. */
    clear() {
        this._stretches = [];
    }

    /** How many stretches wait. */
    get size() {
        return this._stretches.length;
    }
}
