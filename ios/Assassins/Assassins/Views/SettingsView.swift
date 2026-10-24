import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State var settings: GameSettings
    let onSave: (GameSettings) -> Void
    @State private var newZone = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Match") {
                    Stepper("Length: \(settings.durationMinutes) min", value: $settings.durationMinutes, in: 3...90, step: settings.durationMinutes < 10 ? 1 : 5)
                    Stepper("Battle bus: \(settings.busSeconds)s", value: $settings.busSeconds, in: 10...300, step: 10)
                    Stepper("Starting shield: \(settings.startingShield)", value: $settings.startingShield, in: 0...GameService.maxShield)
                }

                if settings.arena == .outdoor {
                    Section {
                        Stepper("Target ping: every \(settings.pingIntervalSeconds)s", value: $settings.pingIntervalSeconds, in: 15...300, step: 15)
                        Toggle("Storm", isOn: $settings.stormEnabled)
                        if settings.stormEnabled {
                            Stepper("First circle: \(formatDistance(Double(settings.zoneRadiusMeters)))", value: $settings.zoneRadiusMeters, in: 50...3000, step: 50)
                        }
                    } header: {
                        Text("Outdoor")
                    } footer: {
                        Text("The storm is centered on the host when the bus launches.")
                    }
                } else {
                    Section {
                        Toggle("Storm closes rooms", isOn: $settings.stormEnabled)
                        ForEach(settings.indoorZones, id: \.self) { Text($0) }
                            .onDelete { settings.indoorZones.remove(atOffsets: $0) }
                        HStack {
                            TextField("Add a room", text: $newZone)
                            Button("Add") {
                                let zone = newZone.trimmingCharacters(in: .whitespaces)
                                if !zone.isEmpty && !settings.indoorZones.contains(zone) { settings.indoorZones.append(zone) }
                                newZone = ""
                            }
                        }
                    } header: {
                        Text("Indoor rooms")
                    } footer: {
                        Text("Rooms close one at a time until one is left. Supply drops land in open rooms.")
                    }
                }

                Section("Loot") {
                    Toggle("Supply drops", isOn: Binding(
                        get: { settings.lootIntervalSeconds > 0 },
                        set: { settings.lootIntervalSeconds = $0 ? 120 : 0 }
                    ))
                    if settings.lootIntervalSeconds > 0 {
                        Stepper("Every \(settings.lootIntervalSeconds)s", value: $settings.lootIntervalSeconds, in: 30...600, step: 30)
                    }
                }
            }
            .navigationTitle(settings.modeTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(settings); dismiss() }.bold()
                }
            }
        }
    }
}
