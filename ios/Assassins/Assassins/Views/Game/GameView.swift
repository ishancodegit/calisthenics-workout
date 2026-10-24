import SwiftUI

struct GameView: View {
    @Environment(AppModel.self) private var app
    let session: GameSession
    @State private var showSquad = false
    @State private var confirmLeave = false

    var body: some View {
        ZStack {
            Group {
                if session.isOutdoor {
                    OutdoorMapView(session: session)
                } else {
                    IndoorRadarView(session: session)
                }
            }
            .ignoresSafeArea()

            if session.attacker != nil { UnderAttackGlow() }

            VStack(spacing: 8) {
                TopHUD(session: session, showSquad: $showSquad, confirmLeave: $confirmLeave)
                KillFeed(session: session)
                Spacer()
                ActionPanel(session: session)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)

            if session.phase == .bus { BusOverlay(session: session) }

            if let hit = session.hitsOnMe.first {
                HitConfirmOverlay(session: session, hit: hit)
            }

            VStack {
                if let banner = session.banner {
                    BannerView(banner: banner)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .id(banner.id)
                }
                Spacer()
            }
            .padding(.top, 70)
            .animation(.spring(duration: 0.35), value: session.banner)
            .allowsHitTesting(false)
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
        .onChange(of: session.attacker?.id) { _, attacker in
            if attacker != nil { Haptics.error() }
        }
        .sheet(isPresented: $showSquad) { SquadSheet(session: session) }
        .confirmationDialog("Leave the match?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave (counts as eliminated)", role: .destructive) { Task { await app.leave() } }
        }
    }
}

struct TopHUD: View {
    let session: GameSession
    @Binding var showSquad: Bool
    @Binding var confirmLeave: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Label("\(session.alivePlayers.count) LEFT", systemImage: "person.3.fill")
                Label("\(session.me?.eliminations ?? 0) ELIMS", systemImage: "scope")
            }
            .font(.caption.weight(.heavy))

            Spacer()

            VStack(spacing: 2) {
                Text(clockTitle).font(.caption2.weight(.heavy)).foregroundStyle(clockColor)
                Text(clockValue).font(.system(size: 22, weight: .black, design: .monospaced))
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 6) {
                HealthBar(shield: session.me?.shield ?? 0, alive: session.amAlive)
                Menu {
                    Button { showSquad = true } label: { Label("Squad", systemImage: "person.3") }
                    Button(role: .destructive) { confirmLeave = true } label: { Label("Leave match", systemImage: "door.left.hand.open") }
                } label: {
                    Image(systemName: "ellipsis.circle.fill").font(.title2)
                }
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var clockTitle: String {
        if session.phase == .bus { return "BATTLE BUS" }
        if let storm = session.stormState, storm.nextChangeAt != nil {
            return storm.shrinking ? "STORM CLOSING" : "STORM SHRINKS IN"
        }
        if let closure = session.nextClosure { return "\(closure.zone.uppercased()) CLOSES IN" }
        return "TIME LEFT"
    }

    private var clockValue: String {
        let now = session.now
        if session.phase == .bus, let fight = session.fightStart { return formatClock(fight.timeIntervalSince(now)) }
        if let change = session.stormState?.nextChangeAt { return formatClock(change.timeIntervalSince(now)) }
        if let closure = session.nextClosure { return formatClock(closure.closesAt.timeIntervalSince(now)) }
        return formatClock((session.endAt ?? now).timeIntervalSince(now))
    }

    private var clockColor: Color {
        session.stormState?.shrinking == true ? Theme.storm : .secondary
    }
}

struct KillFeed: View {
    let session: GameSession

    var body: some View {
        let recent = (session.game?.feed ?? []).filter { session.now.timeIntervalSince($0.at) < 25 }.suffix(4)
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(recent)) { entry in
                Text(entry.text)
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.black.opacity(0.55), in: Capsule())
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.easeOut, value: recent.map(\.id))
        .allowsHitTesting(false)
    }
}

struct BusOverlay: View {
    let session: GameSession

    var body: some View {
        let departing = session.game?.startAt.map { $0 > session.now } ?? false
        VStack(spacing: 10) {
            Text("🚌").font(.system(size: 70))
            Text(departing ? "BUS DEPARTING" : "BATTLE BUS").font(.display(34)).foregroundStyle(Theme.gold)
            if departing, let start = session.game?.startAt {
                Text(formatClock(start.timeIntervalSince(session.now))).font(.display(64))
            } else {
                Text("Spread out! No eliminations yet.").font(.headline)
                if let fight = session.fightStart {
                    Text("Targets assigned in \(formatClock(fight.timeIntervalSince(session.now)))")
                        .font(.title3.weight(.heavy))
                        .foregroundStyle(.secondary)
                }
            }
            Text(session.settings.modeTitle.uppercased()).font(.caption.weight(.heavy)).foregroundStyle(.secondary).padding(.top, 6)
        }
        .padding(28)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24))
        .padding(30)
        .allowsHitTesting(false)
    }
}

struct UnderAttackGlow: View {
    @State private var pulse = false

    var body: some View {
        RoundedRectangle(cornerRadius: 0)
            .strokeBorder(Theme.danger, lineWidth: pulse ? 26 : 10)
            .blur(radius: 12)
            .ignoresSafeArea()
            .opacity(pulse ? 1 : 0.5)
            .allowsHitTesting(false)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.4).repeatForever()) { pulse = true }
            }
    }
}

struct HitConfirmOverlay: View {
    let session: GameSession
    let hit: HitClaim

    var body: some View {
        let left = GameSession.hitAutoConfirmSeconds - session.now.timeIntervalSince(hit.at)
        ZStack {
            Color.black.opacity(0.6).ignoresSafeArea()
            VStack(spacing: 16) {
                Text("💥").font(.system(size: 60))
                Text("\(session.label(hit.shooterId)) says they hit you!")
                    .font(.display(24))
                    .multilineTextAlignment(.center)
                Text("Be honest. Counts automatically in \(Int(max(0, left)))s.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Yeah, I'm hit") { session.respond(to: hit, accept: true) }
                    .buttonStyle(BigButtonStyle(color: Theme.danger, foreground: .white))
                Button("Nope, missed") { session.respond(to: hit, accept: false) }
                    .buttonStyle(BigButtonStyle(color: Theme.card, foreground: .white))
            }
            .padding(24)
            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).stroke(Theme.danger, lineWidth: 2))
            .padding(24)
        }
    }
}

struct SquadSheet: View {
    let session: GameSession

    var body: some View {
        NavigationStack {
            List {
                ForEach(session.standings) { p in
                    HStack {
                        Text(p.emoji).font(.title2)
                        VStack(alignment: .leading) {
                            Text(p.name).font(.headline).strikethrough(!p.alive)
                            // Spectators get to see the whole chain.
                            if !session.amAlive, p.alive, let target = session.player(p.targetId) {
                                Text("hunting \(target.emoji) \(target.name)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text("\(p.eliminations) 🎯").font(.subheadline.bold())
                        if !p.alive, let place = p.placement { Text("#\(place)").foregroundStyle(.secondary) }
                    }
                }
            }
            .navigationTitle("Squad")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}
