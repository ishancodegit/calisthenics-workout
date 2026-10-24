import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app
    @AppStorage("playerName") private var name = ""
    @AppStorage("playerEmoji") private var emoji = "🥷"

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            if let session = app.session {
                SessionView(session: session)
            } else {
                HomeView()
            }
        }
        .task {
            if !name.isEmpty { await app.rejoinIfNeeded(name: name, emoji: emoji) }
        }
    }
}

struct SessionView: View {
    @Environment(AppModel.self) private var app
    let session: GameSession

    var body: some View {
        Group {
            if !session.hasLoaded {
                ProgressView("Joining…")
            } else if let game = session.game {
                switch game.status {
                case .lobby: LobbyView(session: session)
                case .active: GameView(session: session)
                case .finished: ResultsView(session: session)
                }
            } else {
                VStack(spacing: 16) {
                    Text("This lobby closed").font(.display(28))
                    Button("Back home") { app.close() }.buttonStyle(BigButtonStyle())
                }
                .padding(24)
            }
        }
        .alert("Something went wrong", isPresented: Binding(
            get: { session.errorMessage != nil },
            set: { if !$0 { session.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(session.errorMessage ?? "")
        }
    }
}

struct SetupNeededView: View {
    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("ONE MORE STEP").font(.display(34)).foregroundStyle(Theme.gold)
                Text("Assassins needs a free Firebase project so everyone's phones can sync.")
                VStack(alignment: .leading, spacing: 8) {
                    Text("1. Create a project at console.firebase.google.com")
                    Text("2. Add an iOS app with this app's bundle id")
                    Text("3. Turn on Cloud Firestore")
                    Text("4. Download GoogleService-Info.plist into the Assassins folder")
                    Text("5. Run xcodegen again and rebuild")
                }
                .font(.callout)
                .foregroundStyle(.secondary)
                Text("Full steps are in ios/Assassins/README.md.").font(.footnote)
            }
            .padding(24)
        }
    }
}
