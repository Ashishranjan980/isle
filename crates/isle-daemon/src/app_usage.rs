// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

//! App usage: the extension times the app in front and reports each stretch here. Kept day by day for
//! a month, in `~/.local/share/isle/app-usage.json`, and shown on the Apps page.

use isle_core::app_usage::{AppTotal, AppUsage, KEEP_DAYS};
use log::warn;
use serde::Serialize;
use tokio::sync::Notify;
use zbus::object_server::{InterfaceRef, SignalEmitter};
use zbus::{fdo, interface};

use crate::clock::{days_back, next_midnight, today, wait_until};
use crate::store::Store;

/// What the `Stats` property holds: today, the last seven days including today, and the last 30.
#[derive(Serialize)]
struct Stats {
    today: Vec<AppTotal>,
    week: Vec<AppTotal>,
    month: Vec<AppTotal>,
}

/// The AppUsage1 D-Bus object: the times and their file.
pub struct AppUsageService {
    usage: AppUsage,
    store: Store<AppUsage>,
}

impl AppUsageService {
    /// Loads the stored days, dropping those past the month kept.
    pub fn load() -> Self {
        let mut store = Store::new("app-usage");
        let mut usage: AppUsage = store.load();
        let keep = days_back(KEEP_DAYS);
        if keep.first().is_some_and(|oldest| usage.prune(oldest)) {
            store.save(&usage);
        }
        Self { usage, store }
    }

    /// Saves and publishes the new times.
    async fn changed(&self, emitter: &SignalEmitter<'_>) -> zbus::Result<()> {
        self.store.save(&self.usage);
        self.stats_changed(emitter).await
    }

    /// Today's apps, the last seven days', and the last 30 (all that is kept).
    fn snapshot(&self) -> Stats {
        let days = days_back(KEEP_DAYS);
        let today = days.last().map_or("", String::as_str);
        let week = &days[days.len().saturating_sub(7)..];
        Stats {
            today: self.usage.totals([today]),
            week: self.usage.totals(week.iter().map(String::as_str)),
            month: self.usage.totals(days.iter().map(String::as_str)),
        }
    }
}

#[interface(name = "io.github.zickrian.isle.AppUsage1")]
impl AppUsageService {
    /// Adds a stretch of `ms` in `app_id`, named `name`; the extension sends one as focus moves.
    async fn report(
        &mut self,
        app_id: &str,
        name: &str,
        ms: i64,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        if !self.usage.record(&today(), app_id, name, ms) {
            return Err(fdo::Error::InvalidArgs(
                "an app id and 1 ms to 24 hours are needed".into(),
            ));
        }
        Ok(self.changed(&emitter).await?)
    }

    /// Forgets every day, as Settings offers.
    async fn clear(
        &mut self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<()> {
        self.usage.clear();
        Ok(self.changed(&emitter).await?)
    }

    /// JSON `{today: [{id, name, ms}], week: [{id, name, ms}]}`, most used first.
    #[zbus(property)]
    fn stats(&self) -> String {
        serde_json::to_string(&self.snapshot()).unwrap_or_default()
    }
}

/// Drops days past the month kept as midnight passes, and tells clients that today is new.
pub async fn run(iface: InterfaceRef<AppUsageService>) {
    let wake = Notify::new();
    loop {
        if !wait_until(next_midnight(), &wake).await {
            continue;
        }
        let mut service = iface.get_mut().await;
        let keep = days_back(KEEP_DAYS);
        if keep
            .first()
            .is_some_and(|oldest| service.usage.prune(oldest))
        {
            service.store.save(&service.usage);
        }
        if let Err(err) = service.stats_changed(iface.signal_emitter()).await {
            warn!("could not publish app usage after midnight: {err}");
        }
    }
}
