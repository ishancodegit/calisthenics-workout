import UIKit
import UserNotifications

enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func heavy() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func heartbeat() {
        let g = UIImpactFeedbackGenerator(style: .rigid)
        g.impactOccurred(intensity: 1)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { g.impactOccurred(intensity: 0.6) }
    }
}

/// Local notifications so the storm and supply drops still buzz you with the phone in your pocket.
enum MatchNotifications {
    private static var center: UNUserNotificationCenter { .current() }

    static func requestPermission() {
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    static func cancelAll() {
        center.removeAllPendingNotificationRequests()
    }

    static func schedule(for game: Game) {
        cancelAll()
        guard let startAt = game.startAt else { return }
        let settings = game.settings
        let now = Date()
        var items: [(date: Date, title: String, body: String)] = [
            (MatchRules.fightStart(startAt, settings), "🎯 Targets assigned", "The bus is empty. Hunt or be hunted."),
            (MatchRules.endTime(startAt, settings), "⏱ Time's up!", "Open Assassins to see who won."),
        ]
        for circle in (game.storm ?? []).dropFirst() {
            items.append((circle.shrinkStart, "⛈️ The storm is closing", "Get inside the next circle."))
        }
        for closure in game.closures ?? [] {
            items.append((closure.closesAt, "⛈️ \(closure.zone) is closed", "Get out of the \(closure.zone) now!"))
        }
        for drop in game.drops ?? [] {
            let place = drop.zone.map { " in the \($0)" } ?? ""
            items.append((drop.landsAt, "📦 Supply drop\(place)!", "\(drop.item.emoji) Grab it before anyone else."))
        }

        for (index, item) in items.filter({ $0.date > now }).sorted(by: { $0.date < $1.date }).prefix(60).enumerated() {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, item.date.timeIntervalSince(now)), repeats: false)
            center.add(UNNotificationRequest(identifier: "assassins-\(index)", content: content, trigger: trigger))
        }
    }
}
