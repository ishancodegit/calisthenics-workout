import SwiftUI

/// Everything at the bottom of the match screen: target, warnings, actions, inventory.
struct ActionPanel: View {
    let session: GameSession
    @State private var nerfSheet: NerfSheet.Mode?

    var body: some View {
        VStack(spacing: 10) {
            if session.amAlive {
                if session.phase == .fighting {
                    alerts
                    targetCard
                    actions
                    bottomRow
                }
            } else {
                eliminatedCard
            }
        }
        .sheet(item: $nerfSheet) { mode in
            NerfSheet(session: session, mode: mode)
        }
    }

    // MARK: Target

    @ViewBuilder private var targetCard: some View {
        if let target = session.myTarget {
            HStack(spacing: 12) {
                Text(target.emoji).font(.system(size: 34))
                VStack(alignment: .leading, spacing: 2) {
                    Text("YOUR TARGET").font(.caption2.weight(.heavy)).foregroundStyle(Theme.danger)
                    Text(target.name).font(.display(24))
                    Text(trackingText(target)).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    HealthBar(shield: target.shield, alive: target.alive).scaleEffect(0.8)
                    if session.targetLevel > .none { SignalBars(level: session.targetLevel, color: Theme.danger) }
                }
            }
            .padding(12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.danger.opacity(0.6), lineWidth: 1.5))
        }
    }

    private func trackingText(_ target: Player) -> String {
        if target.isCloaked(now: session.now) { return "👻 Cloaked. Can't track them right now." }
        if session.isOutdoor {
            if session.radarActive { return "📡 Radar: live on your map" }
            if let ping = session.targetPing {
                return "📍 Pinged \(Int(session.now.timeIntervalSince(ping.at)))s ago. Next ping soon."
            }
            return "📍 Waiting for their first ping…"
        }
        return "Signal: \(session.targetLevel.label)"
    }

    // MARK: Alerts

    @ViewBuilder private var alerts: some View {
        if let attacker = session.attacker {
            alertRow("⚠️ \(attacker.name.uppercased()) IS ELIMINATING YOU", "Run, or hold COUNTER!", Theme.danger)
        } else if session.hunterNearby {
            alertRow("💓 YOUR HUNTER IS CLOSE",
                     session.revealedHunter.map { "It's \($0.emoji) \($0.name)." } ?? "Watch your back.",
                     Theme.danger)
        } else if let hunter = session.revealedHunter {
            alertRow("🕵️ HUNTED BY \(hunter.name.uppercased())", "You can take them out in self-defense.", Theme.purple)
        }
        if session.iAmInStorm {
            alertRow("⛈️ YOU'RE IN THE STORM",
                     "Lose a \((session.me?.shield ?? 0) > 0 ? "shield" : "life") in \(GameSession.stormTickSeconds - session.stormExposure)s. Get to the circle!",
                     Theme.storm)
        }
    }

    private func alertRow(_ title: String, _ message: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.subheadline.weight(.black))
            Text(message).font(.caption.weight(.semibold))
        }
        .frame(maxWidth: .infinity)
        .padding(10)
        .background(color.opacity(0.85), in: RoundedRectangle(cornerRadius: 12))
        .foregroundStyle(.white)
    }

    // MARK: Actions

    @ViewBuilder private var actions: some View {
        if session.isNerf {
            HStack(spacing: 10) {
                Button { nerfSheet = .iHit } label: { Text("🎯 I hit") }
                    .buttonStyle(BigButtonStyle(color: Theme.gold))
                Button { nerfSheet = .gotHit } label: { Text("💥 I got hit") }
                    .buttonStyle(BigButtonStyle(color: Theme.danger, foreground: .white))
            }
        } else if let victim = session.strikeable {
            let isCounter = victim.id == session.attacker?.id
            HoldButton(title: isCounter ? "COUNTER \(victim.name.uppercased())" : "ELIMINATE \(victim.name.uppercased())",
                       subtitle: "Hold 3s and stay close",
                       color: isCounter ? Theme.purple : Theme.danger,
                       onStart: { session.beginStrike(on: victim) },
                       onCancel: { session.cancelStrike(on: victim) },
                       onComplete: { session.completeStrike(on: victim) })
                .id(victim.id)
        } else {
            Text("Get right next to your target to eliminate them")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(10)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }

        if session.isOutdoor, let drop = session.reachableDrop {
            HoldButton(title: "OPEN SUPPLY DROP", subtitle: "\(drop.item.emoji) \(drop.item.title)",
                       color: Theme.gold, duration: 3) { session.grab(drop) }
                .id(drop.id)
        } else if !session.isOutdoor, let drop = session.activeDrops.first {
            HoldButton(title: "GRAB \(drop.item.emoji) \(drop.item.title.uppercased())",
                       subtitle: drop.zone.map { "Only if you're in the \($0)!" } ?? "First to finish holding wins",
                       color: Theme.gold, duration: 4) { session.grab(drop) }
                .id(drop.id)
        }
    }

    // MARK: Inventory + emotes

    private var bottomRow: some View {
        HStack(spacing: 8) {
            ForEach(0..<GameService.maxItems, id: \.self) { i in
                let item = session.me.flatMap { i < $0.items.count ? $0.items[i] : nil }
                Button {
                    if let item { session.use(item) }
                } label: {
                    Text(item?.emoji ?? "")
                        .font(.system(size: 26))
                        .frame(width: 54, height: 54)
                        .background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(item == nil ? Color.white.opacity(0.15) : Theme.gold, lineWidth: 1.5))
                }
                .disabled(item == nil)
            }
            Spacer()
            emoteMenu
        }
        .padding(8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var emoteMenu: some View {
        Menu {
            ForEach(GameSession.emotes, id: \.self) { e in
                Button(e) { session.emote(e) }
            }
        } label: {
            Text("💬").font(.system(size: 26))
                .frame(width: 54, height: 54)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: Eliminated

    private var eliminatedCard: some View {
        VStack(spacing: 6) {
            Text("ELIMINATED").font(.display(32)).foregroundStyle(Theme.danger)
            if let me = session.me {
                Text(eliminatedBy(me)).font(.headline)
                if let place = me.placement { Text("You placed #\(place)").font(.subheadline).foregroundStyle(.secondary) }
            }
            Text("Spectating. You can see everyone now.").font(.caption).foregroundStyle(.secondary)
            HStack {
                Spacer()
                emoteMenu
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
    }

    private func eliminatedBy(_ me: Player) -> String {
        switch me.eliminatedBy ?? "" {
        case "storm": return "The storm got you ⛈️"
        case "left": return "You left the match"
        case let id: return "by \(session.label(id))"
        }
    }
}

/// Nerf mode: pick who you hit, or who hit you.
struct NerfSheet: View {
    enum Mode: String, Identifiable {
        case iHit, gotHit
        var id: String { rawValue }
    }

    @Environment(\.dismiss) private var dismiss
    let session: GameSession
    let mode: Mode

    var body: some View {
        NavigationStack {
            List {
                if mode == .iHit, let target = session.myTarget {
                    Section("Your target") {
                        row(target, highlight: true)
                    }
                }
                Section {
                    ForEach(session.alivePlayers.filter { $0.id != session.myId && (mode == .gotHit || $0.id != session.myTarget?.id) }) { p in
                        row(p, highlight: false)
                    }
                } header: {
                    Text(mode == .iHit ? "Self-defense" : "Who got you?")
                } footer: {
                    Text(mode == .iHit
                         ? "Hitting someone who isn't your target only counts if they're hunting you."
                         : "Only your target or your hunter can hurt you. Be honest!")
                }
            }
            .navigationTitle(mode == .iHit ? "Who did you hit?" : "Who hit you?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Cancel") { dismiss() } }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ p: Player, highlight: Bool) -> some View {
        Button {
            if mode == .iHit { session.claimHit(on: p) } else { session.reportHit(by: p) }
            dismiss()
        } label: {
            HStack {
                Text(p.emoji).font(.title2)
                Text(p.name).font(.headline)
                Spacer()
                HealthBar(shield: p.shield, alive: p.alive).scaleEffect(0.8)
            }
        }
        .foregroundStyle(highlight ? Theme.danger : .primary)
    }
}
