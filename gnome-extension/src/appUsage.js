// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// App usage: times the application in front and sends each stretch to isled, which keeps the days.
// Event driven: a focus change, screen lock (GNOME disables the extension), or the Apps page asking
// sends what was timed; no timer runs while nothing asks. See docs/product-spec.md.

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {AppUsageSession} from './appUsageSession.js';

/** A flick between windows is not worth a D-Bus call, nor a row. */
const MIN_REPORT_MS = 1000;

/** Times the focused app, while `enabled`; isled stores and sums it. */
export class AppUsage {
    constructor(daemon) {
        this._daemon = daemon;
        this._enabled = false;
        // Monotonic milliseconds: a wall clock could jump with a time-zone or NTP change.
        this._session = new AppUsageSession(() => Math.round(GLib.get_monotonic_time() / 1000));
        this._focusId = 0;
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
        this._session.switchTo(this._focusedApp());
    }

    _stop() {
        this._send(this._session.end());
        if (this._focusId) {
            Shell.WindowTracker.get_default().disconnect(this._focusId);
            this._focusId = 0;
        }
    }

    /** The app in front changed: send the old app's stretch, then time the new one. */
    _onFocus() {
        if (!this._enabled)
            return;
        this._send(this._session.switchTo(this._focusedApp()));
    }

    /** The Apps page asks: send what is timed so far, and keep timing. */
    flush() {
        this._send(this._session.flush());
    }

    /** The app in front now as {id, name}, or null when no window has focus. */
    _focusedApp() {
        const app = Shell.WindowTracker.get_default().focus_app;
        if (!app)
            return null;
        const name = app.get_name() ?? '';
        let id = app.get_id() ?? '';
        if (!id) {
            // A window without a desktop file: its WM class is steady between runs.
            const window = global.display.focus_window;
            const wmClass = window?.get_wm_class_instance?.() || window?.get_wm_class?.() || '';
            id = wmClass ? `window:${wmClass}` : name ? `app:${name}` : '';
        }
        return id ? {id, name: name || id} : null;
    }

    /** Reports a stretch, unless it is too short to be one. */
    _send(stretch) {
        if (!stretch || stretch.ms < MIN_REPORT_MS)
            return;
        this._daemon.call('appUsage', 'Report', stretch.id, stretch.name, stretch.ms);
    }

    /** Stops timing and sends the last stretch. */
    destroy() {
        this.enabled = false;
    }
}
