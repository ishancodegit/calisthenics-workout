import Foundation
import CoreLocation
import FirebaseFirestore

enum GameError: LocalizedError {
    case notFound, alreadyStarted, full, couldNotCreate

    var errorDescription: String? {
        switch self {
        case .notFound: return "No game with that code. Double-check it with your friend."
        case .alreadyStarted: return "That match already started. Wait for the next round."
        case .full: return "That lobby is full (20 players max)."
        case .couldNotCreate: return "Couldn't create a lobby. Try again."
        }
    }
}

enum DamageCause {
    case player(String)
    case storm
    /// Left the match: out, no matter how much shield.
    case forfeit
}

enum DamageOutcome {
    case shieldBroken, eliminated, nothing
}

enum ClaimOutcome {
    case grabbed(Item), taken, inventoryFull
}

/// All reads and writes to Firestore. Layout:
///   games/{code}                 -> Game
///   games/{code}/players/{id}    -> Player
///   games/{code}/hits/{id}       -> HitClaim (Nerf mode)
final class GameService {
    static let shared = GameService()
    static let maxPlayers = 20
    static let maxShield = 2
    static let maxItems = 3

    private var db: Firestore { Firestore.firestore() }

    private func gameRef(_ code: String) -> DocumentReference {
        db.collection("games").document(code)
    }

    private func playersRef(_ code: String) -> CollectionReference {
        gameRef(code).collection("players")
    }

    private func hitsRef(_ code: String) -> CollectionReference {
        gameRef(code).collection("hits")
    }

    private func encode<T: Encodable>(_ value: T) throws -> [String: Any] {
        try Firestore.Encoder().encode(value)
    }

    private func feedEntry(_ text: String) -> [String: Any] {
        ["id": UUID().uuidString, "at": Timestamp(date: Date()), "text": text]
    }

    static func randomCode() -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<5).map { _ in alphabet.randomElement()! })
    }

    // MARK: Lobby

    func createGame(host: Player) async throws -> String {
        for _ in 0..<10 {
            let code = Self.randomCode()
            let ref = gameRef(code)
            if try await ref.getDocument().exists { continue }
            let game = Game(id: code, hostId: host.id, status: .lobby, settings: GameSettings(), createdAt: Date())
            try await ref.setData(try encode(game))
            try await playersRef(code).document(host.id).setData(try encode(host))
            return code
        }
        throw GameError.couldNotCreate
    }

    func joinGame(code: String, player: Player) async throws {
        let snap = try await gameRef(code).getDocument()
        guard snap.exists, let game = try? snap.data(as: Game.self) else { throw GameError.notFound }
        // Already in this game (e.g. app relaunch): just rejoin.
        if try await playersRef(code).document(player.id).getDocument().exists { return }
        guard game.status != .active else { throw GameError.alreadyStarted }
        let count = try await playersRef(code).getDocuments().count
        guard count < Self.maxPlayers else { throw GameError.full }
        try await playersRef(code).document(player.id).setData(try encode(player))
    }

    func listenGame(_ code: String, onChange: @escaping (Game?) -> Void) -> ListenerRegistration {
        gameRef(code).addSnapshotListener { snap, _ in
            guard let snap else { return }
            onChange(snap.exists ? try? snap.data(as: Game.self) : nil)
        }
    }

    func listenPlayers(_ code: String, onChange: @escaping ([Player]) -> Void) -> ListenerRegistration {
        playersRef(code).addSnapshotListener { snap, _ in
            guard let snap else { return }
            onChange(snap.documents.compactMap { try? $0.data(as: Player.self) })
        }
    }

    func listenHits(_ code: String, onChange: @escaping ([HitClaim]) -> Void) -> ListenerRegistration {
        hitsRef(code).whereField("status", isEqualTo: "pending").addSnapshotListener { snap, _ in
            guard let snap else { return }
            onChange(snap.documents.compactMap { try? $0.data(as: HitClaim.self) })
        }
    }

    func updateSettings(_ code: String, _ settings: GameSettings) async throws {
        try await gameRef(code).updateData(["settings": try encode(settings)])
    }

    private struct RoundSetup: Encodable {
        var storm: [StormCircle]
        var closures: [ZoneClosure]
        var drops: [LootDrop]
        var claims: [String: String] = [:]
        var feed: [FeedEntry]
    }

    func startGame(_ code: String, settings: GameSettings, players: [Player], center: CLLocationCoordinate2D?) async throws {
        let startAt = Date().addingTimeInterval(5)
        let chain = MatchRules.targetChain(players.map(\.id))
        var storm: [StormCircle] = []
        var closures: [ZoneClosure] = []
        if settings.stormEnabled {
            if settings.arena == .outdoor, let center, settings.zoneRadiusMeters > 0 {
                storm = MatchRules.makeStorm(center: center, startAt: startAt, settings: settings)
            } else if settings.arena == .indoor {
                closures = MatchRules.makeClosures(startAt: startAt, settings: settings)
            }
        }
        let setup = RoundSetup(
            storm: storm,
            closures: closures,
            drops: MatchRules.makeDrops(startAt: startAt, settings: settings, storm: storm, closures: closures),
            feed: [FeedEntry(id: UUID().uuidString, at: Date(), text: "🚌 The battle bus has departed!")]
        )
        var gameData = try encode(setup)
        gameData["status"] = GameStatus.active.rawValue
        gameData["startAt"] = Timestamp(date: startAt)
        gameData["winnerId"] = FieldValue.delete()
        gameData["endedAt"] = FieldValue.delete()

        let batch = db.batch()
        batch.updateData(gameData, forDocument: gameRef(code))
        for p in players {
            var data = freshPlayerFields(shield: settings.startingShield)
            if let target = chain[p.id] { data["targetId"] = target }
            batch.updateData(data, forDocument: playersRef(code).document(p.id))
        }
        try await batch.commit()
    }

    private func freshPlayerFields(shield: Int) -> [String: Any] {
        [
            "alive": true,
            "shield": shield,
            "items": [String](),
            "eliminations": 0,
            "targetId": FieldValue.delete(),
            "placement": FieldValue.delete(),
            "eliminatedBy": FieldValue.delete(),
            "eliminatedAt": FieldValue.delete(),
            "cloakUntil": FieldValue.delete(),
            "revealedHunterId": FieldValue.delete(),
            "underAttackBy": FieldValue.delete(),
            "attackAt": FieldValue.delete(),
        ]
    }

    func resetToLobby(_ code: String, players: [Player]) async throws {
        let batch = db.batch()
        let cleared = ["startAt", "storm", "closures", "drops", "claims", "feed", "winnerId", "endedAt"]
        var gameData: [String: Any] = ["status": GameStatus.lobby.rawValue]
        for key in cleared { gameData[key] = FieldValue.delete() }
        batch.updateData(gameData, forDocument: gameRef(code))
        for p in players {
            batch.updateData(freshPlayerFields(shield: 0), forDocument: playersRef(code).document(p.id))
        }
        try await batch.commit()
    }

    func leave(_ code: String, playerId: String, game: Game?, players: [Player]) async throws {
        if game?.status == .active, players.first(where: { $0.id == playerId })?.alive == true {
            // Mid-match: count it as an elimination so the target chain stays whole.
            _ = try await applyDamage(code, victimId: playerId, cause: .forfeit, playerIds: players.map(\.id))
            return
        }
        try await playersRef(code).document(playerId).delete()
        let others = players.filter { $0.id != playerId }
        if others.isEmpty {
            try await gameRef(code).delete()
        } else if game?.hostId == playerId, let next = others.min(by: { $0.joinedAt < $1.joinedAt }) {
            try await gameRef(code).updateData(["hostId": next.id])
        }
    }

    // MARK: In the match

    func updateLocation(_ code: String, playerId: String, _ coordinate: CLLocationCoordinate2D) async throws {
        try await playersRef(code).document(playerId).updateData([
            "lat": coordinate.latitude,
            "lon": coordinate.longitude,
            "locationUpdatedAt": Timestamp(date: Date()),
        ])
    }

    func postFeed(_ code: String, _ text: String) async throws {
        try await gameRef(code).updateData(["feed": FieldValue.arrayUnion([feedEntry(text)])])
    }

    /// No Nerf mode: tell the victim someone is holding ELIMINATE on them (nil clears it).
    func setAttack(_ code: String, victimId: String, attackerId: String?) async throws {
        let data: [String: Any] = attackerId.map { ["underAttackBy": $0, "attackAt": Timestamp(date: Date())] }
            ?? ["underAttackBy": FieldValue.delete(), "attackAt": FieldValue.delete()]
        try await playersRef(code).document(victimId).updateData(data)
    }

    func useItem(_ code: String, player: Player, item: Item, hunterId: String?) async throws {
        var items = player.items
        if let i = items.firstIndex(of: item) { items.remove(at: i) }
        var data: [String: Any] = ["items": items.map(\.rawValue)]
        switch item {
        case .cloak: data["cloakUntil"] = Timestamp(date: Date().addingTimeInterval(60))
        case .intel: data["revealedHunterId"] = hunterId.map { $0 as Any } ?? FieldValue.delete()
        case .shield: data["shield"] = min(Self.maxShield, player.shield + 1)
        case .radar: break
        }
        try await playersRef(code).document(player.id).updateData(data)
    }

    func claimHit(_ code: String, shooterId: String, victimId: String) async throws {
        let id = UUID().uuidString
        let hit = HitClaim(id: id, shooterId: shooterId, victimId: victimId, at: Date(), status: "pending")
        try await hitsRef(code).document(id).setData(try encode(hit))
    }

    func denyHit(_ code: String, hitId: String) async throws {
        try await hitsRef(code).document(hitId).updateData(["status": "denied"])
    }

    /// Shield takes the hit first. At zero shield you're out: whoever was hunting
    /// you inherits your target, and the last one standing wins.
    /// Passing `hitId` only counts the damage if that claim is still pending.
    func applyDamage(_ code: String, victimId: String, cause: DamageCause, playerIds: [String],
                     hitId: String? = nil) async throws -> DamageOutcome {
        let gameRef = gameRef(code)
        let playersRef = playersRef(code)
        let hitRef = hitId.map { hitsRef(code).document($0) }

        let result = try await db.runTransaction { txn, errorPointer -> Any? in
            do {
                // All reads first.
                let game = try txn.getDocument(gameRef).data(as: Game.self)
                var hit: HitClaim?
                if let hitRef { hit = try txn.getDocument(hitRef).data(as: HitClaim.self) }
                var players: [Player] = []
                for id in playerIds {
                    let snap = try txn.getDocument(playersRef.document(id))
                    if snap.exists, let p = try? snap.data(as: Player.self) { players.append(p) }
                }

                guard game.status == .active,
                      let victim = players.first(where: { $0.id == victimId }), victim.alive
                else { return "nothing" }
                if let hit {
                    guard hit.status == "pending", let start = game.startAt, hit.at >= start else { return "nothing" }
                }

                var attacker: Player?
                if case .player(let attackerId) = cause {
                    // Only your target or your hunter can hurt you.
                    guard let a = players.first(where: { $0.id == attackerId }), a.alive,
                          a.targetId == victimId || victim.targetId == attackerId
                    else { return "nothing" }
                    attacker = a
                }

                var writes: [String: [String: Any]] = [:]
                func write(_ id: String, _ data: [String: Any]) {
                    writes[id, default: [:]].merge(data) { _, new in new }
                }
                var feed: [[String: Any]] = []
                var outcome = "shield"

                if let hitRef { txn.updateData(["status": "accepted"], forDocument: hitRef) }

                let forfeit: Bool = { if case .forfeit = cause { return true }; return false }()
                if victim.shield > 0 && !forfeit {
                    write(victim.id, ["shield": victim.shield - 1,
                                      "underAttackBy": FieldValue.delete(), "attackAt": FieldValue.delete()])
                    let by = attacker.map { "\($0.emoji) \($0.name)" } ?? "⛈️ The storm"
                    feed.append(self.feedEntry("💥 \(by) cracked \(victim.emoji) \(victim.name)'s shield"))
                } else {
                    outcome = "eliminated"
                    let aliveCount = players.filter(\.alive).count
                    let by: String
                    switch cause {
                    case .player(let id): by = id
                    case .storm: by = "storm"
                    case .forfeit: by = "left"
                    }
                    write(victim.id, ["alive": false, "shield": 0, "placement": aliveCount,
                                      "eliminatedBy": by, "eliminatedAt": Timestamp(date: Date()),
                                      "targetId": FieldValue.delete(),
                                      "underAttackBy": FieldValue.delete(), "attackAt": FieldValue.delete()])
                    if let r = MatchRules.reassignment(after: victim.id, in: players) {
                        write(r.hunterId, ["targetId": r.newTarget.map { $0 as Any } ?? FieldValue.delete()])
                    }
                    if let attacker {
                        write(attacker.id, ["eliminations": attacker.eliminations + 1])
                    }
                    let left = aliveCount - 1
                    let how: String
                    switch cause {
                    case .player: how = "🎯 \(attacker!.emoji) \(attacker!.name) eliminated \(victim.emoji) \(victim.name)"
                    case .storm: how = "⛈️ \(victim.emoji) \(victim.name) was eliminated by the storm"
                    case .forfeit: how = "🏳️ \(victim.emoji) \(victim.name) left the match"
                    }
                    feed.append(self.feedEntry("\(how) · \(left) left"))

                    if left <= 1 {
                        let winner = players.first { $0.alive && $0.id != victim.id }
                        var gameData: [String: Any] = ["status": GameStatus.finished.rawValue,
                                                       "endedAt": Timestamp(date: Date())]
                        if let winner {
                            gameData["winnerId"] = winner.id
                            write(winner.id, ["placement": 1, "targetId": FieldValue.delete()])
                            feed.append(self.feedEntry("👑 \(winner.emoji) \(winner.name) wins the Victory Royale!"))
                        }
                        txn.updateData(gameData, forDocument: gameRef)
                    }
                }

                for (id, data) in writes {
                    txn.updateData(data, forDocument: playersRef.document(id))
                }
                txn.updateData(["feed": FieldValue.arrayUnion(feed)], forDocument: gameRef)
                return outcome
            } catch {
                errorPointer?.pointee = error as NSError
                return nil
            }
        }
        switch result as? String {
        case "shield": return .shieldBroken
        case "eliminated": return .eliminated
        default: return .nothing
        }
    }

    func claimDrop(_ code: String, dropId: String, playerId: String) async throws -> ClaimOutcome {
        let gameRef = gameRef(code)
        let playerRef = playersRef(code).document(playerId)
        let result = try await db.runTransaction { txn, errorPointer -> Any? in
            do {
                let game = try txn.getDocument(gameRef).data(as: Game.self)
                let player = try txn.getDocument(playerRef).data(as: Player.self)
                guard game.status == .active, player.alive,
                      let drop = game.drops?.first(where: { $0.id == dropId }),
                      game.claims?[dropId] == nil
                else { return "taken" }

                if drop.item == .shield {
                    guard player.shield < Self.maxShield else { return "full" }
                    txn.updateData(["shield": player.shield + 1], forDocument: playerRef)
                } else {
                    guard player.items.count < Self.maxItems else { return "full" }
                    txn.updateData(["items": (player.items + [drop.item]).map(\.rawValue)], forDocument: playerRef)
                }
                txn.updateData([
                    "claims.\(dropId)": playerId,
                    "feed": FieldValue.arrayUnion([self.feedEntry("📦 \(player.emoji) \(player.name) grabbed a \(drop.item.title)")]),
                ], forDocument: gameRef)
                return drop.item.rawValue
            } catch {
                errorPointer?.pointee = error as NSError
                return nil
            }
        }
        switch result as? String {
        case "full": return .inventoryFull
        case let raw?: return Item(rawValue: raw).map { .grabbed($0) } ?? .taken
        default: return .taken
        }
    }

    /// Time's up with several players standing. Most eliminations takes #1.
    func finishOnTime(_ code: String, playerIds: [String]) async throws {
        let gameRef = gameRef(code)
        let playersRef = playersRef(code)
        _ = try await db.runTransaction { txn, errorPointer -> Any? in
            do {
                let game = try txn.getDocument(gameRef).data(as: Game.self)
                var players: [Player] = []
                for id in playerIds {
                    let snap = try txn.getDocument(playersRef.document(id))
                    if snap.exists, let p = try? snap.data(as: Player.self) { players.append(p) }
                }
                guard game.status == .active else { return nil }
                let standing = players.filter(\.alive).sorted {
                    ($0.eliminations, $0.shield) > ($1.eliminations, $1.shield)
                }
                for (i, p) in standing.enumerated() {
                    txn.updateData(["placement": i + 1], forDocument: playersRef.document(p.id))
                }
                var data: [String: Any] = ["status": GameStatus.finished.rawValue, "endedAt": Timestamp(date: Date())]
                var feed = [self.feedEntry("⏱ Time's up!")]
                if let winner = standing.first {
                    data["winnerId"] = winner.id
                    feed.append(self.feedEntry("👑 \(winner.emoji) \(winner.name) wins with \(winner.eliminations) elims!"))
                }
                data["feed"] = FieldValue.arrayUnion(feed)
                txn.updateData(data, forDocument: gameRef)
                return nil
            } catch {
                errorPointer?.pointee = error as NSError
                return nil
            }
        }
    }
}
