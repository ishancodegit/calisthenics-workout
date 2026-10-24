import Foundation
import CoreBluetooth
import Observation

/// Bluetooth "metal detector". Every phone advertises its player id as a BLE service
/// UUID and scans for everyone else's, so we get a rough distance from signal strength.
/// Works indoors where GPS is useless, but only while the app is open on screen.
@Observable
final class Proximity: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate {
    enum Level: Int, Comparable {
        case none, far, nearby, close, veryClose, touching

        static func < (a: Level, b: Level) -> Bool { a.rawValue < b.rawValue }

        var label: String {
            switch self {
            case .none: return "No signal"
            case .far: return "Far"
            case .nearby: return "Nearby"
            case .close: return "Close"
            case .veryClose: return "Very close"
            case .touching: return "Right on top of you"
            }
        }

        /// 0...5 bars.
        var bars: Int { rawValue }
    }

    /// Smoothed RSSI per player id. Not observed on purpose: it updates many times a
    /// second, and the game screen already refreshes once a second.
    @ObservationIgnored private var rssi: [String: Double] = [:]
    var bluetoothUnavailable = false

    @ObservationIgnored private var lastSeen: [String: Date] = [:]
    @ObservationIgnored private var central: CBCentralManager?
    @ObservationIgnored private var peripheral: CBPeripheralManager?
    @ObservationIgnored private var myUUID: CBUUID?
    @ObservationIgnored private var knownIds: Set<String> = []
    @ObservationIgnored private var wantsAdvertising = false

    func start(myId: String) {
        myUUID = CBUUID(string: myId)
        wantsAdvertising = true
        if central == nil {
            central = CBCentralManager(delegate: self, queue: nil)
            peripheral = CBPeripheralManager(delegate: self, queue: nil)
        } else {
            startScanning()
            updateAdvertising()
        }
    }

    func stop() {
        central?.stopScan()
        peripheral?.stopAdvertising()
        wantsAdvertising = false
        rssi = [:]
        lastSeen = [:]
    }

    func track(_ playerIds: [String]) {
        knownIds = Set(playerIds.map { $0.uppercased() })
    }

    /// Cloak turns advertising off so nobody can sense you.
    func setAdvertising(_ on: Bool) {
        guard on != wantsAdvertising else { return }
        wantsAdvertising = on
        updateAdvertising()
    }

    func level(for playerId: String, now: Date = Date()) -> Level {
        let id = playerId.uppercased()
        guard let seen = lastSeen[id], now.timeIntervalSince(seen) < 6, let value = rssi[id] else { return .none }
        switch value {
        case (-58)...: return .touching
        case (-68)...: return .veryClose
        case (-78)...: return .close
        case (-88)...: return .nearby
        default: return .far
        }
    }

    private func startScanning() {
        guard let central, central.state == .poweredOn, !central.isScanning else { return }
        central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }

    private func updateAdvertising() {
        guard let peripheral, peripheral.state == .poweredOn else { return }
        peripheral.stopAdvertising()
        if wantsAdvertising, let myUUID {
            peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [myUUID]])
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        bluetoothUnavailable = central.state == .poweredOff || central.state == .unauthorized
        startScanning()
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        updateAdvertising()
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let value = RSSI.doubleValue
        guard value < 0, value > -110,
              let uuids = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] else { return }
        for uuid in uuids {
            let id = uuid.uuidString.uppercased()
            guard knownIds.contains(id) else { continue }
            // Smooth out the (very noisy) signal.
            rssi[id] = rssi[id].map { $0 * 0.7 + value * 0.3 } ?? value
            lastSeen[id] = Date()
        }
    }
}
