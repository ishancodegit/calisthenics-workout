import UIKit
import UserNotifications

enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    static func heavy() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
}

/// Local notifications so pings still buzz your phone when it's in your pocket.
enum PingNotifications {
    private static var center: UNUserNotificationCenter { .current() }

    static func requestPermission() {
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    static func cancelAll() {
        center.removeAllPendingNotificationRequests()
    }

    /// `role` is nil for a runner who got caught and is out of the game.
    static func schedule(huntStart: Date, end: Date, interval: TimeInterval, role: Role?) {
        cancelAll()
        let now = Date()
        var items: [(date: Date, title: String, body: String)] = []

        if huntStart > now {
            items.append((huntStart, "🚨 The hunt is on!",
                          role == .runner ? "Hunters are released. Stay hidden." : "Go find them!"))
        }
        if let role {
            var i = 1
            while items.count < 50 {
                let date = huntStart.addingTimeInterval(Double(i) * interval)
                if date >= end { break }
                if date > now {
                    switch role {
                    case .hunter: items.append((date, "📍 Ping!", "Runners revealed on the map."))
                    case .runner: items.append((date, "📍 You've been pinged!", "Hunters can see where you are. Move!"))
                    }
                }
                i += 1
            }
        }
        if end > now {
            items.append((end, "⏱ Time's up!", "Open Manhunt to see who won."))
        }

        for (index, item) in items.enumerated() {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, item.date.timeIntervalSince(now)), repeats: false)
            center.add(UNNotificationRequest(identifier: "manhunt-\(index)", content: content, trigger: trigger))
        }
    }
}
