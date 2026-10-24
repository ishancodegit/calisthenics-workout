import SwiftUI

struct LobbyView: View {
    @Environment(AppModel.self) private var app
    let session: GameSession
    @State private var showSettings = false
    @State private var confirmLeave = false

    private var settings: GameSettings { session.settings }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                VStack(spacing: 6) {
                    Text("LOBBY CODE").font(.caption.bold()).foregroundStyle(.secondary)
                    Text(session.code)
                        .font(.system(size: 54, weight: .black, design: .monospaced))
                        .foregroundStyle(Theme.gold)
                        .onTapGesture {
                            UIPasteboard.general.string = session.code
                            Haptics.tap()
                        }
                    ShareLink(item: "Join my Assassins lobby! Code: \(session.code)") {
                        Label("Invite friends", systemImage: "square.and.arrow.up")
                            .font(.subheadline.bold())
                    }
                }
                .padding(.top, 16)

                modePicker

                Card {
                    HStack {
                        Text("SETTINGS").font(.caption.bold()).foregroundStyle(.secondary)
                        Spacer()
                        if session.isHost {
                            Button("Edit") { showSettings = true }.font(.subheadline.bold())
                        }
                    }
                    settingRow("⏱", "Match", "\(settings.durationMinutes) min")
                    settingRow("🚌", "Battle bus", "\(settings.busSeconds)s")
                    settingRow("🛡️", "Starting shield", "\(settings.startingShield)")
                    if settings.arena == .outdoor {
                        settingRow("📍", "Target ping", "every \(formatInterval(settings.pingIntervalSeconds))")
                        settingRow("⛈️", "Storm", settings.stormEnabled ? formatDistance(Double(settings.zoneRadiusMeters)) + " circle" : "Off")
                    } else {
                        settingRow("⛈️", "Storm", settings.stormEnabled ? settings.indoorZones.joined(separator: ", ") : "Off")
                    }
                    settingRow("📦", "Supply drops", settings.lootIntervalSeconds > 0 ? "every \(formatInterval(settings.lootIntervalSeconds))" : "Off")
                }

                Card {
                    Text("SQUAD · \(session.players.count)").font(.caption.bold()).foregroundStyle(.secondary)
                    ForEach(session.players) { p in
                        HStack {
                            Text(p.emoji).font(.title2)
                            Text(p.name).font(.headline)
                            if p.id == session.game?.hostId { Image(systemName: "crown.fill").foregroundStyle(Theme.gold) }
                            if p.id == session.myId { Text("YOU").font(.caption2.bold()).foregroundStyle(.secondary) }
                            Spacer()
                        }
                    }
                }

                warnings

                if session.isHost {
                    Button {
                        Haptics.heavy()
                        session.startGame()
                    } label: {
                        Text(session.startProblem ?? "Launch the bus 🚌")
                    }
                    .buttonStyle(BigButtonStyle())
                    .disabled(session.startProblem != nil)
                } else {
                    Text("Waiting for the host to launch…")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                        .padding()
                }

                Button("Leave lobby", role: .destructive) { confirmLeave = true }
                    .font(.subheadline)
            }
            .padding(20)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(settings: settings) { session.updateSettings($0) }
        }
        .confirmationDialog("Leave this lobby?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { Task { await app.leave() } }
        }
    }

    private var modePicker: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                modeTile("🌳", "Outdoor", selected: settings.arena == .outdoor) { setMode(.outdoor, settings.weapons) }
                modeTile("🏠", "Indoor", selected: settings.arena == .indoor) { setMode(.indoor, settings.weapons) }
            }
            HStack(spacing: 10) {
                modeTile("🔫", "Nerf", selected: settings.weapons == .nerf) { setMode(settings.arena, .nerf) }
                modeTile("🤫", "No Nerf", selected: settings.weapons == .phone) { setMode(settings.arena, .phone) }
            }
        }
        .disabled(!session.isHost)
    }

    private func setMode(_ arena: Arena, _ weapons: Weapons) {
        guard arena != settings.arena || weapons != settings.weapons else { return }
        Haptics.tap()
        var next = GameSettings.preset(arena: arena, weapons: weapons)
        next.indoorZones = settings.indoorZones
        session.updateSettings(next)
    }

    private func modeTile(_ icon: String, _ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(icon).font(.system(size: 30))
                Text(title).font(.display(17))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(selected ? Theme.gold : Theme.card, in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(selected ? .black : .white)
        }
        .buttonStyle(.plain)
    }

    private func settingRow(_ icon: String, _ title: String, _ value: String) -> some View {
        HStack {
            Text(icon)
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).bold().multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }

    @ViewBuilder private var warnings: some View {
        if app.location.isDenied && settings.arena == .outdoor {
            Label("Location is off. Turn it on in Settings so the map and storm work.", systemImage: "location.slash.fill")
                .font(.footnote).foregroundStyle(.orange)
        }
        if app.proximity.bluetoothUnavailable && (settings.arena == .indoor || settings.weapons == .phone) {
            Label("Bluetooth is off. It's needed to sense nearby players.", systemImage: "antenna.radiowaves.left.and.right.slash")
                .font(.footnote).foregroundStyle(.orange)
        }
        if settings.arena == .indoor {
            Label("Indoors: keep the app open on screen. That's how phones sense each other.", systemImage: "iphone")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}
