import Foundation
import CoreLocation
import SwiftUI
import FirebaseFirestore

/// Where a player was shown to the other team, and when.
struct Reveal {
    let coordinate: CLLocationCoordinate2D
    let at: Date
}

struct MapPin: Identifiable {
    enum Kind { case live, ping(Date), outOfZone }
    let player: Player
    let role: Role
    let coordinate: CLLocationCoordinate2D
    let kind: Kind
    var id: String { player.id }
}

struct Banner: Identifiable, Equatable {
    let id = UUID()
    let title: String
    var message: String? = nil
    var tint: Color = .white
}

enum Phase: Equatable {
    case lobby, countdown, headStart, hunting, ended
}

/// Live state for one game: listens to Firestore, works out pings, tags and the winner.
@Observable
final class GameSession {
    let code: String
    let myId: String
    let location: LocationManager

    var game: Game?
    var players: [Player] = []
    var hasLoaded = false
    var now = Date()
    var revealed: [String: Reveal] = [:]
    var banner: Banner?
    var errorMessage: String?

    @ObservationIgnored private let service = GameService.shared
    @ObservationIgnored private var listeners: [ListenerRegistration] = []
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var roundStartAt: Date?
    @ObservationIgnored private var lastPingIndex: Int?
    @ObservationIgnored private var lastScanSeen: Date?
    @ObservationIgnored private var knownCaught: Set<String>?
    @ObservationIgnored private var lastWriteAt = Date.distantPast
    @ObservationIgnored private var lastWrittenLocation: CLLocation?
    @ObservationIgnored private var wasNearHunter = false
    @ObservationIgnored private var notificationKey: String?
    @ObservationIgnored private var finishing = false

    init(code: String, myId: String, location: LocationManager) {
        self.code = code
        self.myId = myId
        self.location = location
    }

    // MARK: Lifecycle

    func start() {
        listeners.append(service.listenGame(code) { [weak self] game in
            self?.handleGame(game)
        })
        listeners.append(service.listenPlayers(code) { [weak self] players in
            self?.handlePlayers(players)
        })
        location.onUpdate = { [weak self] loc in
            self?.handleLocation(loc)
        }
        location.start()
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.tick()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    func stop() {
        listeners.forEach { $0.remove() }
        listeners = []
        ticker?.cancel()
        location.onUpdate = nil
        location.setBackgroundUpdates(false)
        PingNotifications.cancelAll()
    }

    // MARK: Derived state

    var settings: GameSettings { game?.settings ?? GameSettings() }
    var me: Player? { players.first { $0.id == myId } }
    var isHost: Bool { game?.hostId == myId }
    var runners: [Player] { players.filter { $0.role == .runner } }
    var hunters: [Player] { players.filter { $0.role == .hunter } }

    var huntStart: Date? {
        game?.startAt?.addingTimeInterval(TimeInterval(settings.headStartSeconds))
    }

    var endAt: Date? {
        huntStart?.addingTimeInterval(TimeInterval(settings.durationMinutes * 60))
    }

    var phase: Phase {
        guard let game else { return .lobby }
        switch game.status {
        case .lobby: return .lobby
        case .finished: return .ended
        case .active:
            guard let start = game.startAt, let huntStart, let endAt else { return .lobby }
            if now < start { return .countdown }
            if now < huntStart { return .headStart }
            if now < endAt { return .hunting }
            return .ended
        }
    }

    /// nil means "out" (caught, and caught runners don't join the hunters).
    func effectiveRole(_ player: Player) -> Role? {
        guard player.caught else { return player.role }
        return settings.caughtRunnersBecomeHunters ? .hunter : nil
    }

    var myRole: Role? { me.flatMap(effectiveRole) }

    func pingIndex(at date: Date) -> Int {
        guard let huntStart, date >= huntStart else { return -1 }
        return Int(date.timeIntervalSince(huntStart) / TimeInterval(settings.pingIntervalSeconds))
    }

    var nextPingAt: Date? {
        guard let huntStart, let endAt else { return nil }
        let next = huntStart.addingTimeInterval(Double(pingIndex(at: now) + 1) * TimeInterval(settings.pingIntervalSeconds))
        return next < endAt ? next : nil
    }

    var runnersLeft: Int { runners.filter { !$0.caught }.count }

    func name(of id: String?) -> String {
        guard let id, let p = players.first(where: { $0.id == id }) else { return "Someone" }
        return p.name
    }

    func isOutOfZone(_ coordinate: CLLocationCoordinate2D?) -> Bool {
        guard settings.zoneRadiusMeters > 0, let center = game?.zoneCenter, let coordinate else { return false }
        return coordinate.distance(to: center) > Double(settings.zoneRadiusMeters)
    }

    var iAmOutOfZone: Bool { isOutOfZone(location.location?.coordinate) }

    /// What I'm allowed to see on the map.
    var pins: [MapPin] {
        guard let me else { return [] }
        let mine = effectiveRole(me)
        var result: [MapPin] = []
        for p in players where p.id != myId {
            guard let role = effectiveRole(p) else { continue }
            let fresh = p.hasFreshLocation(now: now)
            if mine == nil || role == mine {
                // Teammates (or everyone, if I'm out) are shown live.
                if fresh, let c = p.coordinate {
                    result.append(MapPin(player: p, role: role, coordinate: c, kind: .live))
                }
            } else if role == .runner {
                if phase == .hunting, fresh, isOutOfZone(p.coordinate), let c = p.coordinate {
                    result.append(MapPin(player: p, role: role, coordinate: c, kind: .outOfZone))
                } else if let r = revealed[p.id] {
                    result.append(MapPin(player: p, role: role, coordinate: r.coordinate, kind: .ping(r.at)))
                }
            } else if settings.runnersSeeHunterPings, let r = revealed[p.id] {
                result.append(MapPin(player: p, role: role, coordinate: r.coordinate, kind: .ping(r.at)))
            }
        }
        return result
    }

    /// The closest runner I can tag right now, if any.
    var taggableRunner: (player: Player, distance: Double)? {
        guard phase == .hunting, myRole == .hunter, let myLoc = location.location?.coordinate else { return nil }
        return players
            .filter { effectiveRole($0) == .runner && $0.hasFreshLocation(now: now, maxAge: 45) }
            .compactMap { p in p.coordinate.map { (player: p, distance: $0.distance(to: myLoc)) } }
            .filter { $0.distance <= Double(settings.tagRadiusMeters) }
            .min { $0.distance < $1.distance }
    }

    /// For runners: how close the nearest hunter is (only used for the heartbeat warning).
    var nearestHunterDistance: Double? {
        guard myRole == .runner, let myLoc = location.location?.coordinate else { return nil }
        return players
            .filter { effectiveRole($0) == .hunter && $0.hasFreshLocation(now: now) }
            .compactMap { $0.coordinate?.distance(to: myLoc) }
            .min()
    }

    var hunterNearby: Bool {
        guard settings.proximityAlertMeters > 0, phase == .hunting, let d = nearestHunterDistance else { return false }
        return d <= Double(settings.proximityAlertMeters)
    }

    var canGhost: Bool {
        guard let me, myRole == .runner, !me.usedGhost else { return false }
        return phase == .headStart || (phase == .hunting && nextPingAt != nil)
    }

    var canScan: Bool {
        guard let me, myRole == .hunter, !me.usedScan else { return false }
        return phase == .hunting
    }

    var ghostActive: Bool {
        guard let me, let idx = me.ghostPingIndex else { return false }
        return idx > pingIndex(at: now)
    }

    // MARK: Actions

    func setRole(_ role: Role, for player: Player) {
        run { try await self.service.setRoles(self.code, [player.id: role]) }
    }

    func shuffleRoles() {
        let runnerCount = max(1, min(runners.count, players.count - 1))
        let shuffled = players.shuffled()
        var roles: [String: Role] = [:]
        for (i, p) in shuffled.enumerated() {
            roles[p.id] = i < runnerCount ? .runner : .hunter
        }
        Haptics.tap()
        run { try await self.service.setRoles(self.code, roles) }
    }

    func updateSettings(_ settings: GameSettings) {
        run { try await self.service.updateSettings(self.code, settings) }
    }

    var startProblem: String? {
        if players.count < 2 { return "Need at least 2 players" }
        if runners.isEmpty { return "Pick at least 1 runner" }
        if hunters.isEmpty { return "Pick at least 1 hunter" }
        return nil
    }

    func startGame() {
        guard startProblem == nil else { return }
        PingNotifications.requestPermission()
        let center = location.location?.coordinate
        run { try await self.service.startGame(self.code, center: center) }
    }

    func tag(_ runner: Player) {
        Haptics.heavy()
        run { try await self.service.catchRunner(self.code, runnerId: runner.id, by: self.myId) }
    }

    func surrender() {
        run { try await self.service.catchRunner(self.code, runnerId: self.myId, by: nil) }
    }

    func useGhost() {
        guard canGhost else { return }
        let idx = pingIndex(at: now) + 1
        Haptics.success()
        show(Banner(title: "👻 Ghost mode on", message: "You'll be invisible for the next ping.", tint: .purple))
        run { try await self.service.useGhost(self.code, playerId: self.myId, pingIndex: idx) }
    }

    func useScan() {
        guard canScan else { return }
        run { try await self.service.useScan(self.code, playerId: self.myId) }
    }

    func playAgain() {
        run { try await self.service.resetToLobby(self.code, players: self.players) }
    }

    func leave() async {
        try? await service.leave(code, playerId: myId, game: game, players: players)
    }

    private func run(_ work: @escaping () async throws -> Void) {
        Task { @MainActor in
            do { try await work() } catch { self.errorMessage = error.localizedDescription }
        }
    }

    func show(_ banner: Banner) {
        self.banner = banner
        let id = banner.id
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if self.banner?.id == id { self.banner = nil }
        }
    }

    // MARK: Updates

    private func handleGame(_ game: Game?) {
        hasLoaded = true
        self.game = game
        guard let game else { return }

        if game.status == .active {
            if game.startAt != roundStartAt {
                // A new round started: forget everything from the last one.
                roundStartAt = game.startAt
                revealed = [:]
                lastPingIndex = nil
                lastScanSeen = game.scanAt
                knownCaught = Set(players.filter(\.caught).map(\.id))
                wasNearHunter = false
                finishing = false
                notificationKey = nil
                lastWriteAt = .distantPast
            }
            location.setBackgroundUpdates(true)
            if let scan = game.scanAt, scan != lastScanSeen {
                lastScanSeen = scan
                handleScan(by: game.scanBy)
            }
        } else {
            location.setBackgroundUpdates(false)
            if notificationKey != nil {
                PingNotifications.cancelAll()
                notificationKey = nil
            }
            if game.status == .finished, roundStartAt != nil {
                roundStartAt = nil
                Haptics.success()
            }
        }
        evaluateEnd()
    }

    private func handlePlayers(_ players: [Player]) {
        self.players = players.sorted { $0.joinedAt < $1.joinedAt }
        let caught = Set(players.filter(\.caught).map(\.id))
        if let known = knownCaught, game?.status == .active {
            for id in caught.subtracting(known) {
                announceCatch(of: id)
            }
        }
        knownCaught = caught
        evaluateEnd()
    }

    private func announceCatch(of id: String) {
        guard let runner = players.first(where: { $0.id == id }) else { return }
        let by = runner.caughtBy.map { name(of: $0) }
        if id == myId {
            Haptics.error()
            let next = settings.caughtRunnersBecomeHunters ? "You're a hunter now. Go get 'em!" : "You're out. Watch the chase."
            show(Banner(title: "💀 You got caught\(by.map { " by \($0)" } ?? "")", message: next, tint: Theme.hunter))
        } else {
            Haptics.warning()
            let title = by.map { "🎯 \($0) caught \(runner.name)!" } ?? "🎯 \(runner.name) is out!"
            show(Banner(title: title, message: "\(runnersLeft) runner\(runnersLeft == 1 ? "" : "s") left", tint: Theme.hunter))
        }
    }

    private func handleLocation(_ loc: CLLocation) {
        guard game?.status == .active, me != nil else { return }
        let sinceWrite = Date().timeIntervalSince(lastWriteAt)
        let moved = lastWrittenLocation.map { loc.distance(from: $0) } ?? .infinity
        guard sinceWrite >= 3, moved >= 3 || sinceWrite >= 15 else { return }
        lastWriteAt = Date()
        lastWrittenLocation = loc
        let coordinate = loc.coordinate
        Task { try? await service.updateLocation(code, playerId: myId, coordinate) }
    }

    private func tick() {
        now = Date()
        guard game?.status == .active else { return }
        if let loc = location.location { handleLocation(loc) }
        processPings()
        scheduleNotifications()
        checkProximity()
        evaluateEnd()
    }

    private func processPings() {
        guard let endAt, now < endAt else { return }
        let idx = pingIndex(at: now)
        guard idx >= 0, idx != lastPingIndex else { return }
        let isNewPing = lastPingIndex != nil || now.timeIntervalSince(huntStart ?? now) < 2
        lastPingIndex = idx

        for p in players where !p.caught {
            guard let c = p.coordinate else { continue }
            if p.role == .runner && p.ghostPingIndex == idx { continue }
            revealed[p.id] = Reveal(coordinate: c, at: now)
        }
        guard isNewPing else { return }

        Haptics.heavy()
        if idx == 0 {
            show(Banner(title: "🚨 THE HUNT IS ON",
                        message: myRole == .runner ? "Hunters are released. Your spot was just pinged!" : "Runners revealed. Go!",
                        tint: Theme.hunter))
        } else if myRole == .runner {
            if me?.ghostPingIndex == idx {
                show(Banner(title: "👻 You dodged the ping", message: "Hunters didn't see you this time.", tint: .purple))
            } else {
                show(Banner(title: "📍 You've been pinged!", message: "Hunters can see where you are. Move!", tint: Theme.runner))
            }
        } else {
            show(Banner(title: "📍 PING", message: "Runner locations updated.", tint: Theme.hunter))
        }
    }

    private func handleScan(by hunterId: String?) {
        for p in players where effectiveRole(p) == .runner {
            guard let c = p.coordinate else { continue }
            revealed[p.id] = Reveal(coordinate: c, at: Date())
        }
        Haptics.heavy()
        if myRole == .runner {
            show(Banner(title: "📡 A hunter used SCAN!", message: "Your location was just revealed.", tint: Theme.hunter))
        } else {
            show(Banner(title: "📡 \(name(of: hunterId)) scanned!", message: "All runners revealed.", tint: Theme.hunter))
        }
    }

    private func scheduleNotifications() {
        guard let me, let huntStart, let endAt else { return }
        let role = effectiveRole(me)
        let key = "\(huntStart.timeIntervalSince1970)-\(role?.rawValue ?? "out")"
        guard key != notificationKey else { return }
        notificationKey = key
        PingNotifications.schedule(huntStart: huntStart, end: endAt,
                                   interval: TimeInterval(settings.pingIntervalSeconds), role: role)
    }

    private func checkProximity() {
        let near = hunterNearby
        if near && !wasNearHunter { Haptics.warning() }
        wasNearHunter = near
    }

    private func evaluateEnd() {
        guard let game, game.status == .active, !finishing, let endAt, !runners.isEmpty else { return }
        let winner: Role
        if runners.allSatisfy(\.caught) {
            winner = .hunter
        } else if Date() >= endAt {
            winner = .runner
        } else {
            return
        }
        finishing = true
        run { try await self.service.finish(self.code, winner: winner) }
    }
}
