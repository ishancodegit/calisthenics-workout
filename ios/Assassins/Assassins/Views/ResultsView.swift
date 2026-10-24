import SwiftUI

struct ResultsView: View {
    @Environment(AppModel.self) private var app
    let session: GameSession
    @State private var appear = false

    private var winner: Player? { session.player(session.game?.winnerId) }
    private var iWon: Bool { session.game?.winnerId == session.myId }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 6) {
                    Text(iWon ? "👑" : "💀").font(.system(size: 80))
                        .scaleEffect(appear ? 1 : 0.3)
                    if iWon {
                        Text("#1 VICTORY ROYALE").font(.display(36)).foregroundStyle(Theme.gold)
                            .shadow(color: Theme.gold.opacity(0.6), radius: 20)
                    } else {
                        Text(session.me?.placement.map { "#\($0)" } ?? "GG").font(.display(52))
                        if let winner {
                            Text("\(winner.emoji) \(winner.name) won the Victory Royale")
                                .font(.headline).foregroundStyle(Theme.gold)
                        }
                    }
                    if let me = session.me {
                        Text("\(me.eliminations) elimination\(me.eliminations == 1 ? "" : "s")")
                            .font(.title3.weight(.heavy)).foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 30)

                Card {
                    Text("LEADERBOARD").font(.caption.bold()).foregroundStyle(.secondary)
                    ForEach(session.standings) { p in
                        HStack {
                            Text(p.placement.map { "#\($0)" } ?? "–").font(.headline.monospacedDigit()).frame(width: 36, alignment: .leading)
                            Text(p.emoji).font(.title2)
                            VStack(alignment: .leading) {
                                Text(p.name).font(.headline)
                                if let by = p.eliminatedBy {
                                    Text(by == "storm" ? "storm ⛈️" : by == "left" ? "left" : "by \(session.label(by))")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Text("\(p.eliminations) 🎯").font(.headline)
                        }
                        .padding(.vertical, 2)
                        .foregroundStyle(p.id == session.game?.winnerId ? Theme.gold : .primary)
                    }
                }

                if let feed = session.game?.feed, !feed.isEmpty {
                    Card {
                        Text("MATCH FEED").font(.caption.bold()).foregroundStyle(.secondary)
                        ForEach(Array(feed.suffix(12).reversed())) { entry in
                            Text(entry.text).font(.caption)
                        }
                    }
                }

                if session.isHost {
                    Button("Back to lobby") { session.playAgain() }
                        .buttonStyle(BigButtonStyle())
                } else {
                    Text("Waiting for the host to start another round…").foregroundStyle(.secondary)
                }
                Button("Leave", role: .destructive) { Task { await app.leave() } }
            }
            .padding(20)
        }
        .onAppear {
            withAnimation(.spring(duration: 0.6, bounce: 0.5)) { appear = true }
        }
    }
}
