import SwiftUI
import FirebaseCore

@main
struct AssassinsApp: App {
    @State private var app = AppModel()
    private let firebaseReady: Bool

    init() {
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            firebaseReady = true
        } else {
            firebaseReady = false
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if firebaseReady {
                    RootView().environment(app)
                } else {
                    SetupNeededView()
                }
            }
            .preferredColorScheme(.dark)
            .tint(Theme.gold)
        }
    }
}
