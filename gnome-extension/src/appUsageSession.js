// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// The rules of an app usage session, apart from GNOME: which app is timed and for how long. The
// extension wires this to focus signals and isled (see appUsage.js); `node --test` checks it here.
// Input, or its absence, never pauses the clock: the app in front is timed until focus leaves it.

/** A focused app's running time; `now` is a monotonic clock in milliseconds. */
export class AppUsageSession {
    constructor(now) {
        this._now = now;
        this._id = null;
        this._name = '';
        this._since = 0;
    }

    /**
     * Times `app` ({id, name}), or nothing with null. The same app keeps the session it has, so two
     * of its windows do not split the time. Returns the previous app's stretch, if any.
     */
    switchTo(app, now = this._now()) {
        const id = app?.id ?? null;
        if (id === this._id)
            return null;
        const ended = this.flush(now);
        this._id = id;
        this._name = app?.name ?? '';
        this._since = id === null ? 0 : now;
        return ended;
    }

    /** The time since the last report, in ms, and goes on timing; null when nothing is timed. */
    flush(now = this._now()) {
        if (this._id === null)
            return null;
        const ms = Math.max(0, Math.round(now - this._since));
        this._since = now;
        return {id: this._id, name: this._name, ms};
    }

    /** Ends the session, returning its last stretch; nothing is timed afterwards. */
    end(now = this._now()) {
        const ended = this.flush(now);
        this._id = null;
        this._name = '';
        this._since = 0;
        return ended;
    }
}
