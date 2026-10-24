import SwiftUI

/// Indoors there's no map: a Bluetooth "metal detector" for your target.
struct IndoorRadarView: View {
    let session: GameSession

    var body: some View {
        ZStack {
            Theme.background
            RadarRings(level: session.amAlive ? session.targetLevel : .none)

            VStack(spacing: 18) {
                Spacer().frame(height: 150)
                if session.amAlive, let target = session.myTarget {
                    VStack(spacing: 6) {
                        Text("TARGET SIGNAL").font(.caption.weight(.heavy)).foregroundStyle(.secondary)
                        SignalBars(level: session.targetLevel, color: Theme.danger)
                        Text(target.isCloaked(now: session.now) ? "Signal jammed 👻" : session.targetLevel.label)
                            .font(.display(26))
                    }
                } else if !session.amAlive {
                    Text("SPECTATING").font(.display(28)).foregroundStyle(.secondary)
                }
                if session.settings.stormEnabled, !session.settings.indoorZones.isEmpty {
                    zones
                }
                Spacer()
            }
            .padding(.horizontal, 24)
        }
    }

    private var zones: some View {
        let closed = Set(session.closedZones)
        return VStack(spacing: 8) {
            Text("ROOMS").font(.caption.weight(.heavy)).foregroundStyle(.secondary)
            FlowRow(items: session.settings.indoorZones) { zone in
                let isClosed = closed.contains(zone)
                let closingNext = session.nextClosure?.zone == zone
                Text(isClosed ? "⛈️ \(zone)" : zone)
                    .font(.subheadline.weight(.bold))
                    .strikethrough(isClosed)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(isClosed ? Theme.storm.opacity(0.35) : closingNext ? Color.orange.opacity(0.3) : Theme.card,
                                in: Capsule())
                    .foregroundStyle(isClosed ? .secondary : .primary)
            }
        }
    }
}

/// Simple wrapping row of chips.
struct FlowRow<Content: View>: View {
    let items: [String]
    @ViewBuilder let content: (String) -> Content

    var body: some View {
        let rows = stride(from: 0, to: items.count, by: 3).map { Array(items[$0..<min($0 + 3, items.count)]) }
        VStack(spacing: 8) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 8) {
                    ForEach(row, id: \.self) { content($0) }
                }
            }
        }
    }
}

/// Rings pulse faster the closer your target is.
struct RadarRings: View {
    let level: Proximity.Level

    var body: some View {
        TimelineView(.animation) { context in
            let speed = 0.4 + Double(level.bars) * 0.35
            let t = context.date.timeIntervalSinceReferenceDate * speed
            Canvas { ctx, size in
                let center = CGPoint(x: size.width / 2, y: size.height * 0.36)
                let maxR = max(size.width, size.height) * 0.6
                for i in 0..<4 {
                    let phase = (t + Double(i) / 4).truncatingRemainder(dividingBy: 1)
                    let r = maxR * phase
                    let rect = CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
                    let color = level >= .close ? Theme.danger : Theme.gold
                    ctx.stroke(Path(ellipseIn: rect), with: .color(color.opacity((1 - phase) * 0.5)), lineWidth: 2)
                }
            }
        }
        .allowsHitTesting(false)
    }
}
