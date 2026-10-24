import Foundation
import CoreLocation

enum Role: String, Codable, CaseIterable {
    case runner, hunter
}

enum GameStatus: String, Codable {
    case lobby, active, finished
}

struct GameSettings: Codable, Equatable {
    /// Length of the hunt, counted from when the hunters are released.
    var durationMinutes: Int = 30
    var headStartSeconds: Int = 120
    var pingIntervalSeconds: Int = 120
    var tagRadiusMeters: Int = 15
    /// 0 turns the play zone off.
    var zoneRadiusMeters: Int = 600
    /// 0 turns the "hunter nearby" alert off.
    var proximityAlertMeters: Int = 75
    var caughtRunnersBecomeHunters: Bool = true
    var runnersSeeHunterPings: Bool = false

    static let backyard = GameSettings(durationMinutes: 15, headStartSeconds: 60, pingIntervalSeconds: 60,
                                       tagRadiusMeters: 8, zoneRadiusMeters: 150, proximityAlertMeters: 30)
    static let neighborhood = GameSettings()
    static let city = GameSettings(durationMinutes: 60, headStartSeconds: 300, pingIntervalSeconds: 300,
                                   tagRadiusMeters: 20, zoneRadiusMeters: 2000, proximityAlertMeters: 120)
}

struct Game: Codable, Identifiable {
    var id: String
    var hostId: String
    var status: GameStatus
    var settings: GameSettings
    var createdAt: Date
    /// When the head start begins (a few seconds after the host taps Start).
    var startAt: Date?
    var centerLat: Double?
    var centerLon: Double?
    var winner: Role?
    var endedAt: Date?
    var scanAt: Date?
    var scanBy: String?

    var zoneCenter: CLLocationCoordinate2D? {
        guard let centerLat, let centerLon else { return nil }
        return CLLocationCoordinate2D(latitude: centerLat, longitude: centerLon)
    }
}

struct Player: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var emoji: String
    var role: Role
    var joinedAt: Date
    var caught: Bool = false
    var caughtBy: String?
    var caughtAt: Date?
    var usedGhost: Bool = false
    var usedScan: Bool = false
    /// The ping index this runner is hidden from (Ghost power-up).
    var ghostPingIndex: Int?
    var lat: Double?
    var lon: Double?
    var locationUpdatedAt: Date?

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lon else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    func hasFreshLocation(now: Date, maxAge: TimeInterval = 60) -> Bool {
        guard coordinate != nil, let locationUpdatedAt else { return false }
        return now.timeIntervalSince(locationUpdatedAt) <= maxAge
    }
}

extension CLLocationCoordinate2D {
    func distance(to other: CLLocationCoordinate2D) -> CLLocationDistance {
        CLLocation(latitude: latitude, longitude: longitude)
            .distance(from: CLLocation(latitude: other.latitude, longitude: other.longitude))
    }
}

func formatClock(_ seconds: TimeInterval) -> String {
    let s = max(0, Int(seconds.rounded(.up)))
    if s >= 3600 {
        return String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }
    return String(format: "%d:%02d", s / 60, s % 60)
}

func formatDistance(_ meters: Double) -> String {
    meters >= 1000 ? String(format: "%.1f km", meters / 1000) : "\(Int(meters)) m"
}
