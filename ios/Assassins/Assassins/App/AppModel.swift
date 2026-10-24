import Foundation
import Observation

/// Who I am on this phone, and the match I'm in (if any).
@MainActor
@Observable
final class AppModel {
    let playerId: String
    let location = LocationManager()
    let proximity = Proximity()
    var session: GameSession?
    var isBusy = false
    var error: String?

    private let service = GameService.shared
    private static let idKey = "playerId"
    private static let codeKey = "currentGameCode"

    init() {
        if let saved = UserDefaults.standard.string(forKey: Self.idKey) {
            playerId = saved
        } else {
            // A UUID doubles as this player's Bluetooth service id.
            playerId = UUID().uuidString
            UserDefaults.standard.set(playerId, forKey: Self.idKey)
        }
    }

    private func makePlayer(name: String, emoji: String) -> Player {
        Player(id: playerId, name: name.trimmingCharacters(in: .whitespaces), emoji: emoji, joinedAt: Date())
    }

    func create(name: String, emoji: String) async {
        await perform {
            let code = try await self.service.createGame(host: self.makePlayer(name: name, emoji: emoji))
            self.enter(code)
        }
    }

    func join(code: String, name: String, emoji: String) async {
        let code = code.uppercased().trimmingCharacters(in: .whitespaces)
        await perform {
            try await self.service.joinGame(code: code, player: self.makePlayer(name: name, emoji: emoji))
            self.enter(code)
        }
    }

    /// Jump back into the match after the app was closed.
    func rejoinIfNeeded(name: String, emoji: String) async {
        guard session == nil, let code = UserDefaults.standard.string(forKey: Self.codeKey) else { return }
        do {
            try await service.joinGame(code: code, player: makePlayer(name: name, emoji: emoji))
            enter(code)
        } catch {
            UserDefaults.standard.removeObject(forKey: Self.codeKey)
        }
    }

    func leave() async {
        guard let session else { return }
        await session.leave()
        close()
    }

    /// Drop the session without touching the server (e.g. the lobby was deleted).
    func close() {
        session?.stop()
        session = nil
        UserDefaults.standard.removeObject(forKey: Self.codeKey)
    }

    private func enter(_ code: String) {
        UserDefaults.standard.set(code, forKey: Self.codeKey)
        let session = GameSession(code: code, myId: playerId, location: location, proximity: proximity)
        session.start()
        self.session = session
    }

    private func perform(_ work: @escaping () async throws -> Void) async {
        isBusy = true
        defer { isBusy = false }
        do { try await work() } catch { self.error = error.localizedDescription }
    }
}
