# 🎯 Assassins (iOS)

A real-world battle royale for you and your friends. Everyone gets a secret target.
Eliminate your target and you take over theirs. Someone is always hunting you, and
you don't know who. Last one standing gets the Victory Royale.

## Four ways to play

The host picks the mode in the lobby.

| | 🔫 **Nerf** | 🤫 **No Nerf** |
|---|---|---|
| 🌳 **Outdoor** | GPS map + storm circle. Shoot your target with a dart, tap **I HIT**, they confirm. | GPS map + storm circle. Get right next to your target and **hold ELIMINATE for 3s**. |
| 🏠 **Indoor** | Bluetooth signal meter + rooms that close. Same dart flow. | Bluetooth signal meter + rooms that close. Hold ELIMINATE when you're on top of them. |

## How a match goes

1. **Lobby.** The host creates a lobby and shares the 5-letter code. Friends join.
2. **🚌 Battle bus.** Everyone scatters. No eliminations yet.
3. **🎯 Targets assigned.** Everyone is in one secret circle: A hunts B, B hunts C, ... and the last player hunts A.
4. **Hunt.**
   - **Outdoor:** your target's location **pings** on your map every minute (you can change this).
   - **Indoor:** a **signal meter** shows how close your target is, like a metal detector.
   - **💓 Heartbeat:** your phone thumps when your hunter is close. Faster means closer.
5. **Eliminate.** Only your **target** counts, or your **hunter** in self-defense. Hitting anyone else does nothing.
   - **Nerf:** after a hit, tap **I HIT** and pick the player. They get a "Did X hit you?" prompt. If they ignore it, it counts after 20s. You can also tap **I GOT HIT** yourself.
   - **No Nerf:** when you're within about 1 to 3 m, a **hold ELIMINATE** button shows up. Your target's screen flashes red and they can run away or hold **COUNTER** to fight back. Whoever finishes holding first wins.
6. **🛡️ Shields.** A shield soaks up one hit. Nerf mode starts everyone with 1 shield, so it takes 2 hits.
7. **When you get eliminated,** your hunter takes over your target. You keep watching as a spectator and can see everyone and who is hunting whom.
8. **⛈️ Storm.**
   - **Outdoor:** a circle shrinks 4 times. The dashed white circle shows where it's going next. Standing outside costs you a shield (or your life) every 20s.
   - **Indoor:** the host names the rooms (Kitchen, Basement...). They close one by one until only one is left.
9. **📦 Supply drops.**
   - **Outdoor:** drops land on the map. Walk to one and hold to open it.
   - **Indoor:** drops land in a room. First to finish holding GRAB wins.
   - The loot:
     - 🛡️ **Shield Potion:** +1 shield
     - 📡 **Radar:** your target shows live on the map for 30s (outdoor only)
     - 🕵️ **Intel:** reveals who is hunting you
     - 👻 **Cloak:** your hunter can't track you for 60s
10. **👑 Win.** The last one standing wins. If time runs out, the player with the most eliminations wins.

Plus a kill feed, emotes (💬), and a "Back to lobby" button so you can run it back right away.

## Setup (one time, about 10 minutes)

You need a **Mac with Xcode 15 or newer**. Each friend needs the app on their iPhone (iOS 17+).

### 1. Firebase (free), which syncs everyone's phones

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project. Turn off Analytics; you don't need it.
2. Click **Add app → iOS**. Use the bundle id `com.example.assassins`, or your own (see step 2.3).
3. Download **GoogleService-Info.plist** and put it in `ios/Assassins/Assassins/`, next to `Info.plist`.
4. In the console, open **Build → Firestore Database → Create database**. Pick a location and start in **test mode**.
5. Open the **Rules** tab, paste in the contents of [`firestore.rules`](firestore.rules), and click **Publish**.

### 2. Build the app

```bash
brew install xcodegen
cd ios/Assassins
xcodegen            # creates Assassins.xcodeproj
open Assassins.xcodeproj
```

1. In Xcode, select the **Assassins** target → **Signing & Capabilities**, then pick your **Team**. A free Apple ID works.
2. Plug in your iPhone, select it as the run destination, and press **Run ▶︎**. The first build downloads Firebase, which takes a minute.
3. If Xcode says the bundle id is taken, change it to something unique like `com.yourname.assassins`. Then register that same id as an iOS app in Firebase and download the new plist.
4. On the phone, the first time: **Settings → General → VPN & Device Management**, then trust your developer profile.

### 3. Get it on your friends' phones

- **Free:** plug each friend's iPhone into your Mac and press Run. With a free Apple ID the app expires after 7 days; just run it again.
- **$99/yr Apple Developer Program:** upload to **TestFlight** and send your friends an invite link. No cables needed.

## Tips

- **Indoor modes rely on Bluetooth**, so keep the app open on screen. iOS limits Bluetooth for apps in the background.
- **Outdoor modes use GPS.** Allow location access ("While Using" is enough). The app keeps sharing your location while the phone is locked, as long as you don't swipe the app closed.
- GPS is only accurate to about 5 to 10 m, so **No Nerf** outdoors also uses Bluetooth for the final "right next to you" check.
- Allow notifications so storm and supply-drop alerts reach you while the phone is in your pocket.
- The included Firestore rules are wide open, which is fine for a private friends app. Lock them down before any public release.

## Code map

```
Assassins/
  App/            app entry + AppModel (who I am, which lobby I'm in)
  Models/         Models (Firestore data), MatchRules (target chain, storm, loot),
                  GameSession (the live match on this phone)
  Services/       GameService (Firestore + transactions), LocationManager (GPS),
                  Proximity (Bluetooth), Feedback (haptics + notifications)
  Views/          Home, Lobby, Settings, Results, Game/* (HUD, map, radar, actions)
```
