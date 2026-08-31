//! Dates without a date library.
//!
//! `chrono` would be a heavy dependency for the two things this app needs:
//! naming a folder "2024-06", and telling Google Calendar which day we mean.

/// Howard Hinnant's `civil_from_days`. Public domain algorithm.
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Epoch seconds -> "2024-06", for grouping files by month.
pub fn month_folder(secs: u64) -> String {
    let (y, m, _) = civil_from_days((secs / 86_400) as i64);
    format!("{y:04}-{m:02}")
}

/// Epoch seconds -> "2024-06-14T09:30:00Z", which is what Google wants.
pub fn rfc3339(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    let (hh, mm, ss) = (rest / 3600, (rest % 3600) / 60, rest % 60);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Midnight UTC at the start of the day containing `secs`.
pub fn start_of_day(secs: u64) -> u64 {
    secs - (secs % 86_400)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_known_instants() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        // 2024-06-14T09:30:00Z
        assert_eq!(rfc3339(1_718_357_400), "2024-06-14T09:30:00Z");
        assert_eq!(month_folder(1_718_357_400), "2024-06");
    }

    #[test]
    fn handles_leap_days_and_year_boundaries() {
        assert_eq!(rfc3339(1_709_164_800), "2024-02-29T00:00:00Z");
        assert_eq!(rfc3339(1_735_689_599), "2024-12-31T23:59:59Z");
        assert_eq!(rfc3339(1_735_689_600), "2025-01-01T00:00:00Z");
    }

    #[test]
    fn start_of_day_lands_on_midnight() {
        let noon = 1_718_357_400;
        assert_eq!(rfc3339(start_of_day(noon)), "2024-06-14T00:00:00Z");
    }
}
