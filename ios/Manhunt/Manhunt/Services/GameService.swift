import Foundation
import CoreLocation
import FirebaseFirestore

enum GameError: LocalizedError {
    case notFound, alreadyStarted, full, couldNotCreate

    var errorDescription: String? {
        switch self {
        case .notFound: return "No game with that code. Double-check it with your friend."
        case .alreadyStarted: return "That game already started. Ask the host to start a new round."
        case .full: return "That game is full (20 players max)."
        case .couldNotCreate: return "Couldn't create a game. Try again."
        }
    }
}

/// All reads and writes to Firestore. Layout:
///   games/{code}                 -> Game
///   games/{code}/players/{id}    -> Player
final class GameService {
    static let shared = GameService()
    static let maxPlayers = 20

    private var db: Firestore { Firestore.firestore() }

    private func gameRef(_ code: String) -> DocumentReference {
        db.collection("games").document(code)
    }

    private func playersRef(_ code: String) -> CollectionReference {
        gameRef(code).collection("players")
    }

    private func encode<T: Encodable>(_ value: T) throws -> [String: Any] {
        try Firestore.Encoder().encode(value)
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
        guard game.status == .lobby else { throw GameError.alreadyStarted }
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

    func updateSettings(_ code: String, _ settings: GameSettings) async throws {
        try await gameRef(code).updateData(["settings": try encode(settings)])
    }

    func setRoles(_ code: String, _ roles: [String: Role]) async throws {
        let batch = db.batch()
        for (id, role) in roles {
            batch.updateData(["role": role.rawValue], forDocument: playersRef(code).document(id))
        }
        try await batch.commit()
    }

    func startGame(_ code: String, center: CLLocationCoordinate2D?) async throws {
        var data: [String: Any] = [
            "status": GameStatus.active.rawValue,
            "startAt": Timestamp(date: Date().addingTimeInterval(5)),
            "winner": FieldValue.delete(),
            "endedAt": FieldValue.delete(),
            "scanAt": FieldValue.delete(),
            "scanBy": FieldValue.delete(),
        ]
        if let center {
            data["centerLat"] = center.latitude
            data["centerLon"] = center.longitude
        } else {
            data["centerLat"] = FieldValue.delete()
            data["centerLon"] = FieldValue.delete()
        }
        try await gameRef(code).updateData(data)
    }

    // MARK: In game

    func updateLocation(_ code: String, playerId: String, _ coordinate: CLLocationCoordinate2D) async throws {
        try await playersRef(code).document(playerId).updateData([
            "lat": coordinate.latitude,
            "lon": coordinate.longitude,
            "locationUpdatedAt": Timestamp(date: Date()),
        ])
    }

    func catchRunner(_ code: String, runnerId: String, by hunterId: String?) async throws {
        var data: [String: Any] = ["caught": true, "caughtAt": Timestamp(date: Date())]
        if let hunterId { data["caughtBy"] = hunterId }
        try await playersRef(code).document(runnerId).updateData(data)
    }

    func useGhost(_ code: String, playerId: String, pingIndex: Int) async throws {
        try await playersRef(code).document(playerId).updateData([
            "usedGhost": true,
            "ghostPingIndex": pingIndex,
        ])
    }

    func useScan(_ code: String, playerId: String) async throws {
        let batch = db.batch()
        batch.updateData(["usedScan": true], forDocument: playersRef(code).document(playerId))
        batch.updateData(["scanAt": Timestamp(date: Date()), "scanBy": playerId], forDocument: gameRef(code))
        try await batch.commit()
    }

    func finish(_ code: String, winner: Role) async throws {
        try await gameRef(code).updateData([
            "status": GameStatus.finished.rawValue,
            "winner": winner.rawValue,
            "endedAt": Timestamp(date: Date()),
        ])
    }

    func resetToLobby(_ code: String, players: [Player]) async throws {
        let batch = db.batch()
        batch.updateData([
            "status": GameStatus.lobby.rawValue,
            "startAt": FieldValue.delete(),
            "winner": FieldValue.delete(),
            "endedAt": FieldValue.delete(),
            "scanAt": FieldValue.delete(),
            "scanBy": FieldValue.delete(),
        ], forDocument: gameRef(code))
        for p in players {
            batch.updateData([
                "caught": false,
                "caughtBy": FieldValue.delete(),
                "caughtAt": FieldValue.delete(),
                "usedGhost": false,
                "usedScan": false,
                "ghostPingIndex": FieldValue.delete(),
            ], forDocument: playersRef(code).document(p.id))
        }
        try await batch.commit()
    }

    func leave(_ code: String, playerId: String, game: Game?, players: [Player]) async throws {
        try await playersRef(code).document(playerId).delete()
        let others = players.filter { $0.id != playerId }
        if others.isEmpty {
            try await gameRef(code).delete()
        } else if game?.hostId == playerId, let next = others.min(by: { $0.joinedAt < $1.joinedAt }) {
            try await gameRef(code).updateData(["hostId": next.id])
        }
    }
}
