// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// App usage: times the application in front and sends each stretch to isled, which keeps the days.
// Event driven: a focus change, going idle, or the Apps page asking sends what was timed; no timer runs
// while nothing asks. See docs/product-spec.md.

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

/** Without input for this long, the time is the user's absence, not the app's. */
const IDLE_MS = 60 * 1000;
/** A flick between windows is not worth a D-Bus call, nor a row. */
const MIN_REPORT_MS = 1000;

/** Times focus, while `enabled`; isled stores and sums it. */
export class AppUsage {
    constructor(daemon) {
        this._daemon = daemon;
        this._enabled = false;
        /** The app in front and when it came there (monotonic, µs), or null. */
        this._session = null;
        this._since = 0;
        /** Whether the user is away: that time is not the app's. */
        this._away = false;
        this._focusId = 0;
        this._idleWatch = 0;
        this._activeWatch = 0;
    }

    get enabled() {
        return this._enabled;
    }

    /** Starts or stops timing; stopping sends what was not sent yet. */
    set enabled(enabled) {
        enabled = Boolean(enabled);
        if (enabled === this._enabled)
            return;
        this._enabled = enabled;
        if (enabled)
            this._start();
        else
            this._stop();
    }

    _start() {
        const tracker = Shell.WindowTracker.get_default();
        this._focusId = tracker.connect('notify::focus-app', () => this._onFocus());
        const monitor = global.backend.get_core_idle_monitor();
        this._idleWatch = monitor.add_idle_watch(IDLE_MS, () => this._onIdle());
        this._away = false;
        this._startSession();
    }

    _stop() {
        this.flush();
        if (this._focusId) {
            Shell.WindowTracker.get_default().disconnect(this._focusId);
            this._focusId = 0;
        }
        const monitor = global.backend.get_core_idle_monitor();
        for (const name of ['_idleWatch', '_activeWatch']) {
            if (this[name]) {
                monitor.remove_watch(this[name]);
                this[name] = 0;
            }
        }
        this._session = null;
        this._since = 0;
        this._away = false;
    }

    /** The app in front changed: send the time in the old one, then time the new. */
    _onFocus() {
        if (!this._enabled || this._away)
            return;
        this.flush();
        this._startSession();
    }

    /** Away from the computer: the last minute was not the app's either. */
    _onIdle() {
        if (!this._enabled || this._away)
            return;
        this.flush(IDLE_MS);
        this._session = null;
        this._away = true;
        const monitor = global.backend.get_core_idle_monitor();
        this._activeWatch = monitor.add_user_active_watch(() => {
            this._activeWatch = 0;
            if (!this._enabled)
                return;
            this._away = false;
            this._startSession();
        });
    }

    /** The review pane or the Apps page asks: send what is timed so far. */
    flush(idleForMs = 0) {
        if (!this._session)
            return;
        const now = GLib.get_monotonic_time();
        const elapsed = Math.round((now - this._since) / 1000) - idleForMs;
        this._since = now;
        if (elapsed < MIN_REPORT_MS)
            return;
        this._daemon.call('appUsage', 'Report', this._session.id, this._session.name, elapsed);
    }

    /** Times the app in front now, if there is one. */
    _startSession() {
        this._since = GLib.get_monotonic_time();
        this._session = null;
        if (this._away)
            return;
        const app = Shell.WindowTracker.get_default().focus_app;
        if (!app)
            return;
        const name = app.get_name() ?? '';
        let id = app.get_id() ?? '';
        if (!id) {
            // A window without a desktop file: its WM class is steady between runs.
            const window = global.display.focus_window;
            const wmClass = window?.get_wm_class_instance?.() || window?.get_wm_class?.() || '';
            id = wmClass ? `window:${wmClass}` : name ? `app:${name}` : '';
        }
        if (id)
            this._session = {id, name: name || id};
    }

    /** Stops timing and sends the last stretch. */
    destroy() {
        this.enabled = false;
    }
}
