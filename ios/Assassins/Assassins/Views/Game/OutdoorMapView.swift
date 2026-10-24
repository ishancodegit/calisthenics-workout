import SwiftUI
import MapKit

struct OutdoorMapView: View {
    let session: GameSession
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)

    var body: some View {
        Map(position: $camera) {
            UserAnnotation()

            if let storm = session.stormState {
                MapCircle(center: storm.current.center, radius: storm.current.radius)
                    .foregroundStyle(Theme.storm.opacity(0.07))
                    .stroke(Theme.storm, lineWidth: 3)
                if let next = storm.next {
                    MapCircle(center: next.center, radius: next.radius)
                        .foregroundStyle(.clear)
                        .stroke(.white, style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
                }
            }

            ForEach(session.activeDrops) { drop in
                if let c = drop.coordinate {
                    Annotation("Supply drop", coordinate: c) {
                        DropPin(item: drop.item)
                    }
                }
            }

            if let target = session.myTarget {
                if session.radarActive, !target.isCloaked(now: session.now), let c = target.coordinate {
                    Annotation(target.name, coordinate: c) {
                        PlayerPin(player: target, color: Theme.danger, caption: "LIVE")
                    }
                } else if let ping = session.targetPing {
                    Annotation(target.name, coordinate: ping.coordinate) {
                        PlayerPin(player: target, color: Theme.danger,
                                  caption: "\(Int(session.now.timeIntervalSince(ping.at)))s ago",
                                  faded: true)
                    }
                }
            }

            if !session.amAlive {
                // Spectating: see everyone.
                ForEach(session.alivePlayers.filter { $0.hasFreshLocation(now: session.now) }) { p in
                    if let c = p.coordinate {
                        Annotation(p.name, coordinate: c) {
                            PlayerPin(player: p, color: Theme.gold, caption: p.name)
                        }
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .mapControls {
            MapUserLocationButton()
            MapCompass()
        }
    }
}

struct PlayerPin: View {
    let player: Player
    let color: Color
    var caption: String? = nil
    var faded = false
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                Circle().fill(color.opacity(0.25))
                    .frame(width: pulse ? 70 : 40, height: pulse ? 70 : 40)
                    .opacity(pulse ? 0 : 1)
                Text(player.emoji)
                    .font(.system(size: 24))
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(.black.opacity(0.7)))
                    .overlay(Circle().stroke(color, lineWidth: 3))
            }
            if let caption {
                Text(caption).font(.caption2.weight(.heavy))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(color, in: Capsule())
                    .foregroundStyle(.white)
            }
        }
        .opacity(faded ? 0.75 : 1)
        .onAppear {
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { pulse = true }
        }
    }
}

struct DropPin: View {
    let item: Item
    @State private var bob = false

    var body: some View {
        VStack(spacing: 0) {
            Text("🪂").font(.system(size: 22))
            Text("📦").font(.system(size: 30))
                .shadow(color: Theme.gold, radius: 10)
        }
        .offset(y: bob ? -4 : 4)
        .onAppear {
            withAnimation(.easeInOut(duration: 1).repeatForever()) { bob = true }
        }
    }
}
