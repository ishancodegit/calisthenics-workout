import Foundation
import CoreLocation

/// Pure game rules: building a match and working out what the storm is doing.
/// No Firebase in here.
enum MatchRules {
    /// Everyone gets the next person in a shuffled circle as their target.
    static func targetChain(_ playerIds: [String]) -> [String: String] {
        let order = playerIds.shuffled()
        var chain: [String: String] = [:]
        for (i, id) in order.enumerated() {
            chain[id] = order[(i + 1) % order.count]
        }
        return chain
    }

    /// When `victimId` goes down, whoever was hunting them takes over their target.
    /// This also covers self-defense: if you take out your own hunter, their hunter
    /// now hunts you. Returns the hunter's id and their new target (nil = they're last).
    static func reassignment(after victimId: String, in players: [Player]) -> (hunterId: String, newTarget: String?)? {
        guard let victim = players.first(where: { $0.id == victimId }),
              let hunter = players.first(where: { $0.alive && $0.id != victimId && $0.targetId == victimId })
        else { return nil }
        let next = victim.targetId == hunter.id ? nil : victim.targetId
        return (hunter.id, next)
    }

    static func fightStart(_ startAt: Date, _ settings: GameSettings) -> Date {
        startAt.addingTimeInterval(TimeInterval(settings.busSeconds))
    }

    static func endTime(_ startAt: Date, _ settings: GameSettings) -> Date {
        fightStart(startAt, settings).addingTimeInterval(TimeInterval(settings.durationMinutes * 60))
    }

    /// Outdoor storm: 4 circles, each one holds, then shrinks into the next.
    /// The last 10% of the match is the final circle.
    static func makeStorm(center: CLLocationCoordinate2D, startAt: Date, settings: GameSettings) -> [StormCircle] {
        let fight = fightStart(startAt, settings)
        let phaseLength = TimeInterval(settings.durationMinutes * 60) * 0.9 / 4
        let first = Double(settings.zoneRadiusMeters)
        var circles = [StormCircle(lat: center.latitude, lon: center.longitude, radius: first,
                                   shrinkStart: startAt, shrinkEnd: startAt)]
        for k in 1...4 {
            let previous = circles[k - 1]
            let radius = first * pow(0.55, Double(k))
            let wiggle = Double.random(in: 0...(previous.radius - radius))
            let c = previous.center.offset(meters: wiggle, bearing: Double.random(in: 0..<(2 * .pi)))
            let phaseStart = fight.addingTimeInterval(Double(k - 1) * phaseLength)
            circles.append(StormCircle(lat: c.latitude, lon: c.longitude, radius: radius,
                                       shrinkStart: phaseStart.addingTimeInterval(phaseLength * 0.6),
                                       shrinkEnd: phaseStart.addingTimeInterval(phaseLength)))
        }
        return circles
    }

    /// Indoor storm: rooms close one at a time until one is left.
    static func makeClosures(startAt: Date, settings: GameSettings) -> [ZoneClosure] {
        let zones = settings.indoorZones.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.shuffled()
        guard zones.count >= 2 else { return [] }
        let fight = fightStart(startAt, settings)
        let step = TimeInterval(settings.durationMinutes * 60) * 0.9 / Double(zones.count - 1)
        return zones.dropLast().enumerated().map { i, zone in
            ZoneClosure(zone: zone, closesAt: fight.addingTimeInterval(Double(i + 1) * step))
        }
    }

    static func makeDrops(startAt: Date, settings: GameSettings, storm: [StormCircle], closures: [ZoneClosure]) -> [LootDrop] {
        guard settings.lootIntervalSeconds > 0 else { return [] }
        let fight = fightStart(startAt, settings)
        let end = endTime(startAt, settings)
        let table: [Item] = settings.arena == .outdoor
            ? [.shield, .shield, .radar, .radar, .intel, .cloak]
            : [.shield, .shield, .intel, .intel, .cloak, .cloak]
        var drops: [LootDrop] = []
        var t = fight.addingTimeInterval(TimeInterval(settings.lootIntervalSeconds) / 2)
        while t < end.addingTimeInterval(-30) {
            var drop = LootDrop(id: "drop\(drops.count)", item: table.randomElement()!, landsAt: t)
            if settings.arena == .outdoor {
                if let zone = stormState(storm, at: t)?.current {
                    let spot = zone.center.offset(meters: Double.random(in: 0...(zone.radius * 0.7)),
                                                  bearing: Double.random(in: 0..<(2 * .pi)))
                    drop.lat = spot.latitude
                    drop.lon = spot.longitude
                }
            } else {
                drop.zone = openZones(settings: settings, closures: closures, at: t).randomElement()
            }
            drops.append(drop)
            t = t.addingTimeInterval(TimeInterval(settings.lootIntervalSeconds))
        }
        return drops
    }

    struct StormState {
        /// The safe zone right now (it may be mid-shrink).
        var current: (center: CLLocationCoordinate2D, radius: Double)
        /// Where it's heading next, if anywhere.
        var next: StormCircle?
        var shrinking: Bool
        /// When the next change happens (shrink starts or ends).
        var nextChangeAt: Date?
    }

    static func stormState(_ circles: [StormCircle], at t: Date) -> StormState? {
        guard let first = circles.first else { return nil }
        var current = (center: first.center, radius: first.radius)
        for c in circles.dropFirst() {
            if t < c.shrinkStart {
                return StormState(current: current, next: c, shrinking: false, nextChangeAt: c.shrinkStart)
            }
            if t < c.shrinkEnd {
                let p = t.timeIntervalSince(c.shrinkStart) / c.shrinkEnd.timeIntervalSince(c.shrinkStart)
                let lat = current.center.latitude + (c.lat - current.center.latitude) * p
                let lon = current.center.longitude + (c.lon - current.center.longitude) * p
                let radius = current.radius + (c.radius - current.radius) * p
                return StormState(current: (center: CLLocationCoordinate2D(latitude: lat, longitude: lon), radius: radius),
                                  next: c, shrinking: true, nextChangeAt: c.shrinkEnd)
            }
            current = (center: c.center, radius: c.radius)
        }
        return StormState(current: current, next: nil, shrinking: false, nextChangeAt: nil)
    }

    static func openZones(settings: GameSettings, closures: [ZoneClosure], at t: Date) -> [String] {
        let closed = Set(closures.filter { $0.closesAt <= t }.map(\.zone))
        return settings.indoorZones.filter { !closed.contains($0) && !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// Time ran out with more than one player standing: most eliminations wins,
    /// then most shield.
    static func winnerOnTime(_ players: [Player]) -> Player? {
        players.filter(\.alive).max {
            ($0.eliminations, $0.shield) < ($1.eliminations, $1.shield)
        }
    }
}
