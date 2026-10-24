import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var app
    @AppStorage("playerName") private var name = ""
    @AppStorage("playerEmoji") private var emoji = "🥷"
    @State private var code = ""
    @State private var showRules = false

    private var nameOK: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 4) {
                    Text("🎯").font(.system(size: 64))
                    Text("ASSASSINS").font(.display(48)).foregroundStyle(Theme.gold)
                        .shadow(color: Theme.gold.opacity(0.5), radius: 18)
                    Text("Everyone has a target. Nobody knows who's hunting them.")
                        .font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 30)

                Card {
                    Text("YOUR PLAYER").font(.caption.bold()).foregroundStyle(.secondary)
                    TextField("Name", text: $name)
                        .font(.title3.bold())
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Theme.avatars, id: \.self) { e in
                                Text(e).font(.system(size: 30))
                                    .frame(width: 48, height: 48)
                                    .background(e == emoji ? Theme.gold.opacity(0.35) : Color.white.opacity(0.06),
                                                in: RoundedRectangle(cornerRadius: 12))
                                    .onTapGesture { emoji = e; Haptics.tap() }
                            }
                        }
                    }
                }

                Button {
                    Task { await app.create(name: name, emoji: emoji) }
                } label: {
                    Label("Create lobby", systemImage: "plus.circle.fill")
                }
                .buttonStyle(BigButtonStyle())
                .disabled(!nameOK || app.isBusy)

                Card {
                    Text("JOIN A LOBBY").font(.caption.bold()).foregroundStyle(.secondary)
                    HStack {
                        TextField("CODE", text: $code)
                            .font(.display(28))
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .onChange(of: code) { _, new in code = String(new.uppercased().prefix(5)) }
                        Button("Join") {
                            Task { await app.join(code: code, name: name, emoji: emoji) }
                        }
                        .font(.headline)
                        .padding(.horizontal, 22)
                        .padding(.vertical, 12)
                        .background(Theme.purple, in: Capsule())
                        .foregroundStyle(.white)
                        .disabled(!nameOK || code.count < 5 || app.isBusy)
                    }
                }

                Button("How to play") { showRules = true }
                    .font(.headline)
                    .foregroundStyle(Theme.gold)

                if app.isBusy { ProgressView() }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $showRules) { HowToPlayView() }
        .alert("Couldn't join", isPresented: Binding(
            get: { app.error != nil },
            set: { if !$0 { app.error = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(app.error ?? "")
        }
    }
}

struct HowToPlayView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    rule("🚌", "Battle bus", "Everyone scatters. No eliminations yet. When the bus is empty, you get your secret target.")
                    rule("🎯", "Your target", "Eliminate your target and you take over theirs. Everyone is in one big circle, so someone is always hunting you.")
                    rule("⚔️", "Self-defense", "You can also take out the person hunting you, if you figure out who it is. Hitting anyone else doesn't count.")
                    rule("🛡️", "Shields", "A shield soaks up one hit. With no shield left, the next hit knocks you out.")
                    rule("💓", "Heartbeat", "Your phone thumps when your hunter is close. Faster means closer.")
                    rule("⛈️", "The storm", "Outdoors, a circle shrinks on the map. Standing outside it costs you a shield (or your life) every 20s. Indoors, rooms close one by one.")
                    rule("📦", "Supply drops", "Loot lands during the match. First to grab it gets it: Shield Potion, Radar, Intel or Cloak.")
                    rule("👑", "Victory Royale", "Last one standing wins. If time runs out, most eliminations wins.")

                    Text("MODES").font(.display(22)).foregroundStyle(Theme.gold).padding(.top)
                    rule("🌳", "Outdoor", "GPS map. Your target's spot pings on your map every minute or so. The storm is a real circle.")
                    rule("🏠", "Indoor", "No map. A Bluetooth signal meter shows how close your target is, like a metal detector. Keep the app open.")
                    rule("🔫", "Nerf", "Shoot your target with a dart, then tap I HIT. They confirm on their phone (or it auto-confirms after 20s).")
                    rule("🤫", "No Nerf", "Get right next to your target and hold ELIMINATE for 3 seconds. They get warned and can run or hold COUNTER.")
                }
                .padding(20)
            }
            .background(Theme.bg)
            .navigationTitle("How to play")
            .toolbar { Button("Done") { dismiss() } }
        }
    }

    private func rule(_ icon: String, _ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(icon).font(.system(size: 30))
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}
