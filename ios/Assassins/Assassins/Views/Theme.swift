import SwiftUI

enum Theme {
    static let bg = Color(red: 0.04, green: 0.04, blue: 0.09)
    static let card = Color.white.opacity(0.07)
    static let gold = Color(red: 1.0, green: 0.78, blue: 0.18)
    static let purple = Color(red: 0.55, green: 0.3, blue: 1.0)
    static let shield = Color(red: 0.2, green: 0.6, blue: 1.0)
    static let health = Color(red: 0.25, green: 0.9, blue: 0.45)
    static let danger = Color(red: 1.0, green: 0.23, blue: 0.3)
    static let storm = Color(red: 0.62, green: 0.35, blue: 1.0)

    static let background = LinearGradient(
        colors: [Color(red: 0.12, green: 0.05, blue: 0.25), bg, bg],
        startPoint: .top, endPoint: .bottom
    )

    static let avatars = ["🦊", "🐺", "🐸", "🐯", "🦅", "🐙", "👽", "🤖", "🥷", "🦖", "🐼", "💀"]
}

extension Font {
    /// Chunky italic display type for that battle royale look.
    static func display(_ size: CGFloat) -> Font {
        .system(size: size, weight: .black, design: .rounded).italic()
    }
}

struct BigButtonStyle: ButtonStyle {
    var color: Color = Theme.gold
    var foreground: Color = .black

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.display(20))
            .textCase(.uppercase)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(color.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(foreground)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.2), value: configuration.isPressed)
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
    }
}

/// Press and hold to fill the ring. Used to eliminate, counter and open loot.
struct HoldButton: View {
    let title: String
    var subtitle: String? = nil
    var color: Color = Theme.danger
    var duration: Double = 3
    var onStart: () -> Void = {}
    var onCancel: () -> Void = {}
    let onComplete: () -> Void

    @State private var progress: CGFloat = 0
    @State private var holding = false
    @State private var completed = false

    var body: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 18).fill(color.opacity(0.3))
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 18).fill(color)
                    .frame(width: geo.size.width * progress)
            }
            VStack(spacing: 2) {
                Text(holding ? "KEEP HOLDING" : title).font(.display(24))
                if let subtitle { Text(subtitle).font(.caption.bold()).opacity(0.85) }
            }
            .frame(maxWidth: .infinity)
            .foregroundStyle(.white)
        }
        .frame(height: 76)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .scaleEffect(holding ? 0.97 : 1)
        .onLongPressGesture(minimumDuration: duration, maximumDistance: 60) {
            completed = true
            holding = false
            progress = 0
            onComplete()
        } onPressingChanged: { pressing in
            holding = pressing
            if pressing {
                completed = false
                onStart()
                withAnimation(.linear(duration: duration)) { progress = 1 }
            } else {
                if !completed { onCancel() }
                withAnimation(.easeOut(duration: 0.2)) { progress = 0 }
            }
        }
    }
}

/// Shield (blue) + health (green) pips.
struct HealthBar: View {
    let shield: Int
    let alive: Bool

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<GameService.maxShield, id: \.self) { i in
                Capsule().fill(i < shield ? Theme.shield : Color.white.opacity(0.15))
                    .frame(width: 26, height: 10)
            }
            Capsule().fill(alive ? Theme.health : Color.white.opacity(0.15))
                .frame(width: 26, height: 10)
        }
    }
}

struct SignalBars: View {
    let level: Proximity.Level
    var color: Color = Theme.gold

    var body: some View {
        HStack(alignment: .bottom, spacing: 3) {
            ForEach(1...5, id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(i <= level.bars ? color : Color.white.opacity(0.15))
                    .frame(width: 7, height: CGFloat(6 + i * 5))
            }
        }
    }
}

struct BannerView: View {
    let banner: Banner

    var body: some View {
        VStack(spacing: 4) {
            Text(banner.title).font(.display(20)).multilineTextAlignment(.center)
            if let message = banner.message {
                Text(message).font(.subheadline.weight(.semibold)).multilineTextAlignment(.center).opacity(0.9)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(banner.tint, lineWidth: 2))
        .shadow(color: banner.tint.opacity(0.5), radius: 16)
        .padding(.horizontal)
    }
}
