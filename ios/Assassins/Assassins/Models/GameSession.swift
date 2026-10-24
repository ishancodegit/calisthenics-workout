import Foundation
import CoreLocation
import SwiftUI
import FirebaseFirestore

/// Where a player was shown on your map, and when.
struct Reveal {
    let coordinate: CLLocationCoordinate2D
    let at: Date
}

struct Banner: Identifiable, Equatable {
    let id = UUID()
    let title: String
    var message: String? = nil
    var tint: Color = .white
}

enum Phase: Equatable {
    case lobby, bus, fighting, ended
}

/// Live state for one match on this phone: listens to Firestore and works out
/// targets, the storm, loot, strikes and hits.
@Observable
final class GameSession {
    static let emotes = ["🕺 Take the L", "😂 Too easy", "👋 Bye bye", "🔥 I'm on fire", "😱 RUN", "🫡 GG"]
    static let stormTickSeconds = 20
    static let hitAutoConfirmSeconds: TimeInterval = 20

    let code: String
    let myId: String
    let location: LocationManager
    let proximity: Proximity

    var game: Game?
    var players: [Player] = []
    var hits: [HitClaim] = []
    var hasLoaded = false
    var now = Date()
    var banner: Banner?
    var errorMessage: String?
    /// Outdoor: the last place your target pinged.
    var targetPing: Reveal?
    var radarUntil: Date?
    /// Seconds spent outside the storm circle since the last storm damage.
    var stormExposure = 0

    @ObservationIgnored private let service = GameService.shared
    @ObservationIgnored private var listeners: [ListenerRegistration] = []
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var roundStartAt: Date?
    @ObservationIgnored private var lastPingIndex: Int?
    @ObservationIgnored private var lastTargetId: String?
    @ObservationIgnored private var lastPhase: Phase?
    @ObservationIgnored private var wasAlive = true
    @ObservationIgnored private var announcedDrops: Set<String> = []
    @ObservationIgnored private var announcedClosures = 0
    @ObservationIgnored private var announcedShrinks = 0
    @ObservationIgnored private var autoConfirmed: Set<String> = []
    @ObservationIgnored private var lastWriteAt = Date.distantPast
    @ObservationIgnored private var lastWrittenLocation: CLLocation?
    @ObservationIgnored private var lastHeartbeat = Date.distantPast
    @ObservationIgnored private var lastEmoteAt = Date.distantPast
    @ObservationIgnored private var finishing = false
    @ObservationIgnored private var stormHitPending = false

    init(code: String, myId: String, location: LocationManager, proximity: Proximity) {
        self.code = code
        self.myId = myId
        self.location = location
        self.proximity = proximity
    }

    // MARK: Lifecycle

    func start() {
        listeners.append(service.listenGame(code) { [weak self] game in self?.handleGame(game) })
        listeners.append(service.listenPlayers(code) { [weak self] players in self?.handlePlayers(players) })
        listeners.append(service.listenHits(code) { [weak self] hits in self?.hits = hits })
        location.onUpdate = { [weak self] loc in self?.handleLocation(loc) }
        location.start()
        proximity.start(myId: myId)
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
        proximity.stop()
        MatchNotifications.cancelAll()
    }

    // MARK: Derived state

    var settings: GameSettings { game?.settings ?? GameSettings() }
    var isOutdoor: Bool { settings.arena == .outdoor }
    var isNerf: Bool { settings.weapons == .nerf }
    var me: Player? { players.first { $0.id == myId } }
    var isHost: Bool { game?.hostId == myId }
    var alivePlayers: [Player] { players.filter(\.alive) }
    var amAlive: Bool { me?.alive ?? false }

    func player(_ id: String?) -> Player? {
        guard let id else { return nil }
        return players.first { $0.id == id }
    }

    func label(_ id: String?) -> String {
        guard let p = player(id) else { return "Someone" }
        return "\(p.emoji) \(p.name)"
    }

    var fightStart: Date? {
        game?.startAt.map { MatchRules.fightStart($0, settings) }
    }

    var endAt: Date? {
        game?.startAt.map { MatchRules.endTime($0, settings) }
    }

    var phase: Phase {
        guard let game else { return .lobby }
        switch game.status {
        case .lobby: return .lobby
        case .finished: return .ended
        case .active:
            guard let fightStart, let endAt else { return .lobby }
            if now < fightStart { return .bus }
            return now < endAt ? .fighting : .ended
        }
    }

    var myTarget: Player? {
        guard phase == .fighting else { return nil }
        return player(me?.targetId)
    }

    /// Who is hunting me. Secret: only shown after using Intel.
    var myHunter: Player? {
        alivePlayers.first { $0.targetId == myId && $0.id != myId }
    }

    var revealedHunter: Player? {
        guard let hunter = myHunter, me?.revealedHunterId == hunter.id else { return nil }
        return hunter
    }

    /// You can only hurt your target, or your hunter (self-defense).
    func canFight(_ other: Player) -> Bool {
        guard let me, me.alive, other.alive, other.id != myId else { return false }
        return me.targetId == other.id || other.targetId == myId
    }

    // Storm (outdoor)

    var stormState: MatchRules.StormState? {
        guard isOutdoor, let storm = game?.storm, !storm.isEmpty else { return nil }
        return MatchRules.stormState(storm, at: now)
    }

    func isInStorm(_ coordinate: CLLocationCoordinate2D?) -> Bool {
        guard phase == .fighting, let zone = stormState?.current, let coordinate else { return false }
        return coordinate.distance(to: zone.center) > zone.radius
    }

    var iAmInStorm: Bool { amAlive && isInStorm(location.location?.coordinate) }

    // Storm (indoor)

    var openZones: [String] {
        MatchRules.openZones(settings: settings, closures: game?.closures ?? [], at: now)
    }

    var nextClosure: ZoneClosure? {
        (game?.closures ?? []).filter { $0.closesAt > now }.min { $0.closesAt < $1.closesAt }
    }

    var closedZones: [String] {
        (game?.closures ?? []).filter { $0.closesAt <= now }.map(\.zone)
    }

    // Loot

    var activeDrops: [LootDrop] {
        guard phase == .fighting else { return [] }
        return (game?.drops ?? []).filter { $0.landsAt <= now && game?.claims?[$0.id] == nil }
    }

    /// Outdoor: a drop close enough to open.
    var reachableDrop: LootDrop? {
        guard amAlive, let myLoc = location.location?.coordinate else { return nil }
        return activeDrops.first { drop in
            drop.coordinate.map { $0.distance(to: myLoc) <= 20 } ?? false
        }
    }

    // Tracking

    var radarActive: Bool { (radarUntil ?? .distantPast) > now }

    var targetLevel: Proximity.Level {
        guard let target = myTarget, !target.isCloaked(now: now) else { return .none }
        return proximity.level(for: target.id, now: now)
    }

    var targetDistance: Double? {
        guard let target = myTarget, !target.isCloaked(now: now), target.hasFreshLocation(now: now),
              let a = target.coordinate, let b = location.location?.coordinate else { return nil }
        return a.distance(to: b)
    }

    var hunterLevel: Proximity.Level {
        guard let hunter = myHunter else { return .none }
        var level = proximity.level(for: hunter.id, now: now)
        if isOutdoor, hunter.hasFreshLocation(now: now),
           let a = hunter.coordinate, let b = location.location?.coordinate {
            let d = a.distance(to: b)
            let gps: Proximity.Level = d <= 15 ? .veryClose : d <= 35 ? .close : d <= 60 ? .nearby : .none
            level = max(level, gps)
        }
        return level
    }

    var hunterNearby: Bool { phase == .fighting && amAlive && hunterLevel >= .close }

    // Strikes (No Nerf)

    func inStrikeRange(_ other: Player) -> Bool {
        if proximity.level(for: other.id, now: now) >= .veryClose { return true }
        guard isOutdoor, other.hasFreshLocation(now: now, maxAge: 15),
              let a = other.coordinate, let mine = location.location else { return false }
        return a.distance(to: mine.coordinate) <= 6
    }

    var attacker: Player? {
        guard let me, let id = me.underAttackBy, let at = me.attackAt, now.timeIntervalSince(at) < 8 else { return nil }
        return player(id)
    }

    /// Who I can hold ELIMINATE on right now: an attacker (counter) first, then my target.
    var strikeable: Player? {
        guard !isNerf, phase == .fighting, amAlive else { return nil }
        if let attacker, canFight(attacker), inStrikeRange(attacker) { return attacker }
        if let target = myTarget, target.alive, inStrikeRange(target) { return target }
        return nil
    }

    // Hits (Nerf)

    var hitsOnMe: [HitClaim] {
        guard amAlive, let start = game?.startAt else { return [] }
        return hits.filter { $0.victimId == myId && $0.at >= start }
    }

    var standings: [Player] {
        players.sorted { a, b in
            switch (a.placement, b.placement) {
            case let (x?, y?): return x < y
            case (nil, _?): return true
            case (_?, nil): return false
            default: return a.eliminations > b.eliminations
            }
        }
    }

    // MARK: Lobby actions

    func updateSettings(_ settings: GameSettings) {
        run { try await self.service.updateSettings(self.code, settings) }
    }

    var startProblem: String? {
        if players.count < 2 { return "Need at least 2 players" }
        return nil
    }

    func startGame() {
        guard startProblem == nil, let game else { return }
        MatchNotifications.requestPermission()
        let center = location.location?.coordinate
        if game.settings.arena == .outdoor, game.settings.stormEnabled, center == nil {
            show(Banner(title: "No GPS yet", message: "Playing without the storm this round.", tint: .orange))
        }
        let players = self.players
        run { try await self.service.startGame(self.code, settings: game.settings, players: players, center: center) }
    }

    func playAgain() {
        run { try await self.service.resetToLobby(self.code, players: self.players) }
    }

    func leave() async {
        try? await service.leave(code, playerId: myId, game: game, players: players)
    }

    // MARK: Match actions

    func beginStrike(on victim: Player) {
        Haptics.tap()
        run { try await self.service.setAttack(self.code, victimId: victim.id, attackerId: self.myId) }
    }

    func cancelStrike(on victim: Player) {
        run { try await self.service.setAttack(self.code, victimId: victim.id, attackerId: nil) }
    }

    func completeStrike(on victim: Player) {
        Haptics.heavy()
        damage(victim, by: myId)
    }

    /// Nerf: I landed a dart on someone. They have to confirm it.
    func claimHit(on victim: Player) {
        guard canFight(victim) else {
            Haptics.error()
            show(Banner(title: "Doesn't count", message: "You can only hit your target, or your hunter in self-defense.", tint: .orange))
            return
        }
        Haptics.tap()
        show(Banner(title: "🎯 Hit sent", message: "Waiting for \(victim.name) to confirm.", tint: Theme.gold))
        run { try await self.service.claimHit(self.code, shooterId: self.myId, victimId: victim.id) }
    }

    /// Nerf: someone got me. Honor system.
    func reportHit(by shooter: Player) {
        guard canFight(shooter) else {
            show(Banner(title: "Doesn't count", message: "Only your target or your hunter can hurt you. Keep playing!", tint: .orange))
            return
        }
        damage(me!, by: shooter.id)
    }

    func respond(to hit: HitClaim, accept: Bool) {
        if accept {
            let ids = players.map(\.id)
            run { _ = try await self.service.applyDamage(self.code, victimId: hit.victimId, cause: .player(hit.shooterId),
                                                         playerIds: ids, hitId: hit.id) }
        } else {
            run { try await self.service.denyHit(self.code, hitId: hit.id) }
        }
    }

    private func damage(_ victim: Player, by attackerId: String) {
        let ids = players.map(\.id)
        run {
            let outcome = try await self.service.applyDamage(self.code, victimId: victim.id,
                                                             cause: .player(attackerId), playerIds: ids)
            guard attackerId == self.myId else { return }
            switch outcome {
            case .shieldBroken:
                Haptics.success()
                self.show(Banner(title: "💥 Shield cracked!", message: "\(victim.name) has no shield left. Finish them!", tint: Theme.shield))
            case .eliminated:
                Haptics.success()
                self.show(Banner(title: "🎯 ELIMINATED \(victim.name.uppercased())", message: "You take over their target.", tint: Theme.gold))
            case .nothing:
                break
            }
        }
    }

    func grab(_ drop: LootDrop) {
        run {
            switch try await self.service.claimDrop(self.code, dropId: drop.id, playerId: self.myId) {
            case .grabbed(let item):
                Haptics.success()
                self.show(Banner(title: "\(item.emoji) \(item.title)!", message: item.blurb, tint: Theme.gold))
            case .taken:
                self.show(Banner(title: "Too slow!", message: "Someone else got it.", tint: .orange))
            case .inventoryFull:
                self.show(Banner(title: "Inventory full", message: "Use something first.", tint: .orange))
            }
        }
    }

    func use(_ item: Item) {
        guard let me, me.alive, phase == .fighting else { return }
        Haptics.success()
        switch item {
        case .radar:
            radarUntil = Date().addingTimeInterval(30)
            show(Banner(title: "📡 Radar on", message: "Your target is live on the map for 30s.", tint: Theme.gold))
        case .intel:
            let hunter = myHunter
            show(Banner(title: "🕵️ Intel", message: hunter.map { "\($0.emoji) \($0.name) is hunting you." } ?? "Nobody is hunting you.", tint: Theme.gold))
        case .cloak:
            show(Banner(title: "👻 Cloaked", message: "Your hunter can't track you for 60s.", tint: .purple))
        case .shield:
            break
        }
        let hunterId = myHunter?.id
        run { try await self.service.useItem(self.code, player: me, item: item, hunterId: hunterId) }
    }

    func emote(_ text: String) {
        guard let me, Date().timeIntervalSince(lastEmoteAt) > 8 else { return }
        lastEmoteAt = Date()
        Haptics.tap()
        run { try await self.service.postFeed(self.code, "\(me.emoji) \(me.name): \(text)") }
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
                // New round: forget everything from the last one.
                roundStartAt = game.startAt
                lastPingIndex = nil
                lastTargetId = nil
                lastPhase = nil
                targetPing = nil
                radarUntil = nil
                stormExposure = 0
                wasAlive = true
                finishing = false
                autoConfirmed = []
                lastWriteAt = .distantPast
                announcedDrops = Set((game.drops ?? []).filter { $0.landsAt <= Date() }.map(\.id))
                announcedClosures = (game.closures ?? []).filter { $0.closesAt <= Date() }.count
                announcedShrinks = (game.storm ?? []).dropFirst().filter { $0.shrinkStart <= Date() }.count
                MatchNotifications.schedule(for: game)
            }
            location.setBackgroundUpdates(true)
        } else {
            location.setBackgroundUpdates(false)
            if roundStartAt != nil {
                roundStartAt = nil
                MatchNotifications.cancelAll()
                if game.status == .finished { Haptics.success() }
            }
        }
    }

    private func handlePlayers(_ players: [Player]) {
        self.players = players.sorted { $0.joinedAt < $1.joinedAt }
        proximity.track(players.map(\.id).filter { $0 != myId })
    }

    private func handleLocation(_ loc: CLLocation) {
        guard game?.status == .active, me?.alive == true else { return }
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
        proximity.setAdvertising(!(me?.isCloaked(now: now) ?? false))
        announcePhase()
        announceTarget()
        announceWorld()
        processPings()
        processStorm()
        processHeartbeat()
        autoConfirmHits()
        checkTimeUp()
    }

    private func announcePhase() {
        let p = phase
        guard p != lastPhase else { return }
        let previous = lastPhase
        lastPhase = p
        if p == .fighting, previous == .bus {
            Haptics.heavy()
            let target = player(me?.targetId)
            show(Banner(title: "🎯 TARGETS ASSIGNED",
                        message: target.map { "Your target is \($0.emoji) \($0.name). Hunt or be hunted." },
                        tint: Theme.gold))
        }
    }

    private func announceTarget() {
        guard let me else { return }
        if wasAlive && !me.alive {
            Haptics.error()
            targetPing = nil
        }
        wasAlive = me.alive
        guard phase == .fighting, me.alive, me.targetId != lastTargetId else { return }
        let first = lastTargetId == nil
        lastTargetId = me.targetId
        targetPing = nil
        lastPingIndex = nil
        if !first, let target = player(me.targetId) {
            Haptics.heavy()
            show(Banner(title: "🎯 New target", message: "\(target.emoji) \(target.name)", tint: Theme.gold))
        }
    }

    private func announceWorld() {
        guard let game, phase == .fighting else { return }
        for drop in game.drops ?? [] where drop.landsAt <= now && !announcedDrops.contains(drop.id) {
            announcedDrops.insert(drop.id)
            guard game.claims?[drop.id] == nil else { continue }
            Haptics.warning()
            let place = drop.zone.map { "in the \($0)" } ?? (isOutdoor ? "on the map" : "somewhere. First to claim wins")
            show(Banner(title: "📦 SUPPLY DROP", message: "\(drop.item.emoji) \(drop.item.title) landed \(place)!", tint: Theme.gold))
        }
        let closed = (game.closures ?? []).filter { $0.closesAt <= now }.sorted { $0.closesAt < $1.closesAt }
        if closed.count > announcedClosures, let latest = closed.last {
            announcedClosures = closed.count
            Haptics.warning()
            show(Banner(title: "⛈️ \(latest.zone.uppercased()) IS CLOSED", message: "Get out now. Players caught inside are fair game.", tint: Theme.storm))
        }
        let shrinks = (game.storm ?? []).dropFirst().filter { $0.shrinkStart <= now }.count
        if shrinks > announcedShrinks {
            announcedShrinks = shrinks
            Haptics.warning()
            show(Banner(title: "⛈️ THE STORM IS CLOSING", message: "Get inside the white circle.", tint: Theme.storm))
        }
    }

    /// Outdoor: your target's location pings on your map every so often.
    private func processPings() {
        guard isOutdoor, phase == .fighting, let fightStart, let target = myTarget else { return }
        let idx = Int(now.timeIntervalSince(fightStart) / TimeInterval(max(10, settings.pingIntervalSeconds)))
        guard idx != lastPingIndex else { return }
        let isNew = lastPingIndex != nil
        lastPingIndex = idx
        guard !target.isCloaked(now: now), let c = target.coordinate, target.hasFreshLocation(now: now, maxAge: 90) else { return }
        targetPing = Reveal(coordinate: c, at: now)
        if isNew {
            Haptics.tap()
            show(Banner(title: "📍 Target pinged", message: "\(target.name)'s location updated.", tint: Theme.gold))
        }
    }

    /// Outdoor: standing in the storm costs you a shield (or your life) every 20s.
    private func processStorm() {
        guard iAmInStorm else {
            stormExposure = 0
            return
        }
        if stormExposure == 0 { Haptics.warning() }
        stormExposure += 1
        guard stormExposure >= Self.stormTickSeconds, !stormHitPending else { return }
        stormExposure = 0
        stormHitPending = true
        let ids = players.map(\.id)
        Task { @MainActor in
            _ = try? await self.service.applyDamage(self.code, victimId: self.myId, cause: .storm, playerIds: ids)
            self.stormHitPending = false
        }
    }

    private func processHeartbeat() {
        let level = hunterLevel
        guard phase == .fighting, amAlive, level >= .nearby else { return }
        let gap: TimeInterval = level >= .veryClose ? 1 : level >= .close ? 2 : 4
        guard now.timeIntervalSince(lastHeartbeat) >= gap else { return }
        lastHeartbeat = now
        Haptics.heartbeat()
    }

    /// Nerf: a hit nobody answers counts after 20s, so ignoring it doesn't save you.
    private func autoConfirmHits() {
        let ids = players.map(\.id)
        for hit in hits where hit.shooterId == myId && !autoConfirmed.contains(hit.id)
            && now.timeIntervalSince(hit.at) >= Self.hitAutoConfirmSeconds {
            autoConfirmed.insert(hit.id)
            run { _ = try await self.service.applyDamage(self.code, victimId: hit.victimId, cause: .player(hit.shooterId),
                                                         playerIds: ids, hitId: hit.id) }
        }
    }

    private func checkTimeUp() {
        guard let endAt, now >= endAt, !finishing else { return }
        finishing = true
        let ids = players.map(\.id)
        run { try await self.service.finishOnTime(self.code, playerIds: ids) }
    }
}
