// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// The app usage session's rules, with no GNOME:
// `node --experimental-default-type=module --test tests/extension/*.test.js`.

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {AppUsageSession} from '../../gnome-extension/src/appUsageSession.js';

const BRAVE = {id: 'brave-browser.desktop', name: 'Brave Web Browser'};
const CODE = {id: 'code.desktop', name: 'Visual Studio Code'};
const SPOTIFY = {id: 'spotify.desktop', name: 'Spotify'};

test('a focused app keeps counting without input', () => {
    let now = 10_000;
    const session = new AppUsageSession(() => now);
    session.switchTo(BRAVE);
    // Twenty minutes with no keyboard or pointer event, and no focus change.
    now += 20 * 60_000;
    assert.deepEqual(session.flush(), {...BRAVE, ms: 20 * 60_000});
    // A report flushes the stretch but does not reset the app or count it twice.
    now += 60_000;
    assert.deepEqual(session.flush(), {...BRAVE, ms: 60_000});
});

test('focus moving to another app ends the old stretch and starts the new one', () => {
    let now = 0;
    const session = new AppUsageSession(() => now);
    session.switchTo(BRAVE);
    now += 5 * 60_000;
    assert.deepEqual(session.switchTo(CODE, now), {...BRAVE, ms: 5 * 60_000});
    now += 2 * 60_000;
    assert.deepEqual(session.flush(), {...CODE, ms: 2 * 60_000});
});

test('another window of the same app keeps the session whole', () => {
    let now = 0;
    const session = new AppUsageSession(() => now);
    session.switchTo(BRAVE);
    now += 3 * 60_000;
    // The focus moved to another Brave window: the same desktop id is not a new session.
    assert.equal(session.switchTo({...BRAVE}, now), null);
    now += 4 * 60_000;
    assert.deepEqual(session.flush(), {...BRAVE, ms: 7 * 60_000});
});

test('no focused window stops the clock until an app is in front again', () => {
    let now = 0;
    const session = new AppUsageSession(() => now);
    session.switchTo(BRAVE);
    now += 2 * 60_000;
    assert.deepEqual(session.switchTo(null, now), {...BRAVE, ms: 2 * 60_000});
    // The desktop or the overview: no app is in front, so no app's time passes.
    now += 30 * 60_000;
    assert.equal(session.flush(), null);
    session.switchTo(SPOTIFY, now);
    now += 60_000;
    assert.deepEqual(session.flush(), {...SPOTIFY, ms: 60_000});
});

test('ending the session reports its last stretch once', () => {
    let now = 0;
    const session = new AppUsageSession(() => now);
    session.switchTo(BRAVE);
    now += 90_000;
    assert.deepEqual(session.end(), {...BRAVE, ms: 90_000});
    assert.equal(session.end(), null);
    now += 60_000;
    assert.equal(session.flush(), null);
    // A new focus after the session ended starts from zero.
    session.switchTo(BRAVE, now);
    now += 2_000;
    assert.deepEqual(session.flush(), {...BRAVE, ms: 2_000});
});
