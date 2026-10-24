import Foundation
import CoreLocation

enum Arena: String, Codable, CaseIterable {
    case outdoor, indoor
}

enum Weapons: String, Codable, CaseIterable {
    case nerf, phone
}

enum GameStatus: String, Codable {
    case lobby, active, finished
}

enum Item: String, Codable, CaseIterable {
    case shield, radar, intel, cloak

    var emoji: String {
        switch self {
        case .shield: return "🛡️"
        case .radar: return "📡"
        case .intel: return "🕵️"
        case .cloak: return "👻"
        }
    }

    var title: String {
        switch self {
        case .shield: return "Shield Potion"
        case .radar: return "Radar"
        case .intel: return "Intel"
        case .cloak: return "Cloak"
        }
    }

    var blurb: String {
        switch self {
        case .shield: return "+1 shield. Takes a hit for you."
        case .radar: return "See your target live on the map for 30s."
        case .intel: return "Reveals who is hunting you."
        case .cloak: return "Your hunter can't track you for 60s."
        }
    }
}

struct GameSettings: Codable, Equatable {
    var arena: Arena = .outdoor
    var weapons: Weapons = .nerf
    /// Fighting time after the battle bus.
    var durationMinutes: Int = 20
    /// Spread-out time at the start. No eliminations, targets are hidden.
    var busSeconds: Int = 60
    var startingShield: Int = 1
    /// Outdoor: how often your target's location pings on your map.
    var pingIntervalSeconds: Int = 60
    var stormEnabled: Bool = true
    /// Outdoor: radius of the first storm circle.
    var zoneRadiusMeters: Int = 400
    /// Indoor: rooms the storm closes one by one. The last one stays open.
    var indoorZones: [String] = ["Kitchen", "Living Room", "Upstairs", "Basement"]
    /// 0 turns supply drops off.
    var lootIntervalSeconds: Int = 180

    static func preset(arena: Arena, weapons: Weapons) -> GameSettings {
        var s = GameSettings()
        s.arena = arena
        s.weapons = weapons
        s.startingShield = weapons == .nerf ? 1 : 0
        if arena == .indoor {
            s.durationMinutes = 10
            s.busSeconds = 30
            s.lootIntervalSeconds = 90
        }
        return s
    }

    var modeTitle: String {
        "\(arena == .outdoor ? "Outdoor" : "Indoor") · \(weapons == .nerf ? "Nerf" : "No Nerf")"
    }
}

/// One storm circle. The storm shrinks from the previous circle into this one
/// between `shrinkStart` and `shrinkEnd`.
struct StormCircle: Codable, Equatable {
    var lat: Double
    var lon: Double
    var radius: Double
    var shrinkStart: Date
    var shrinkEnd: Date

    var center: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

/// Indoor storm: `zone` becomes off limits at `closesAt`.
struct ZoneClosure: Codable, Equatable {
    var zone: String
    var closesAt: Date
}

struct LootDrop: Codable, Equatable, Identifiable {
    var id: String
    var item: Item
    var landsAt: Date
    /// Outdoor drops land at a spot on the map.
    var lat: Double?
    var lon: Double?
    /// Indoor drops land in a room (nil means "anywhere": first to claim wins).
    var zone: String?

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lon else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

struct FeedEntry: Codable, Equatable, Identifiable {
    var id: String
    var at: Date
    var text: String
}

struct Game: Codable, Identifiable {
    var id: String
    var hostId: String
    var status: GameStatus
    var settings: GameSettings
    var createdAt: Date
    /// Battle bus departs. Fighting starts `busSeconds` later.
    var startAt: Date?
    var storm: [StormCircle]?
    var closures: [ZoneClosure]?
    var drops: [LootDrop]?
    /// dropId -> playerId of whoever grabbed it.
    var claims: [String: String]?
    var feed: [FeedEntry]?
    var winnerId: String?
    var endedAt: Date?
}

struct Player: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var emoji: String
    var joinedAt: Date
    var alive: Bool = true
    var shield: Int = 0
    var targetId: String?
    var items: [Item] = []
    var eliminations: Int = 0
    var placement: Int?
    /// A player id, or "storm".
    var eliminatedBy: String?
    var eliminatedAt: Date?
    var cloakUntil: Date?
    /// Set by Intel: the hunter this player found out about.
    var revealedHunterId: String?
    /// No Nerf mode: someone is holding ELIMINATE on this player.
    var underAttackBy: String?
    var attackAt: Date?
    var lat: Double?
    var lon: Double?
    var locationUpdatedAt: Date?

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lon else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    func hasFreshLocation(now: Date, maxAge: TimeInterval = 45) -> Bool {
        guard coordinate != nil, let locationUpdatedAt else { return false }
        return now.timeIntervalSince(locationUpdatedAt) <= maxAge
    }

    func isCloaked(now: Date) -> Bool {
        guard let cloakUntil else { return false }
        return cloakUntil > now
    }
}

/// A Nerf hit someone says they landed. The victim confirms it (or it auto-confirms).
struct HitClaim: Codable, Identifiable, Equatable {
    var id: String
    var shooterId: String
    var victimId: String
    var at: Date
    var status: String  // pending, accepted, denied
}

extension CLLocationCoordinate2D {
    func distance(to other: CLLocationCoordinate2D) -> CLLocationDistance {
        CLLocation(latitude: latitude, longitude: longitude)
            .distance(from: CLLocation(latitude: other.latitude, longitude: other.longitude))
    }

    /// The point `meters` away in direction `bearing` (radians, 0 = north).
    func offset(meters: Double, bearing: Double) -> CLLocationCoordinate2D {
        let earth = 6_371_000.0
        let dLat = meters * cos(bearing) / earth
        let dLon = meters * sin(bearing) / (earth * cos(latitude * .pi / 180))
        return CLLocationCoordinate2D(latitude: latitude + dLat * 180 / .pi,
                                      longitude: longitude + dLon * 180 / .pi)
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

func formatInterval(_ seconds: Int) -> String {
    seconds >= 60 && seconds % 60 == 0 ? "\(seconds / 60) min" : "\(seconds)s"
}
