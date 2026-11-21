# TaskLock

Locks the apps you choose (Instagram, TikTok…) until the tasks that are due are done.

## Schedules you can set

| Type | Example | When it locks apps |
|---|---|---|
| Every day | Take pills, drink water | Every day until checked off |
| Certain days | Laundry Mon/Thu | On those days until checked off |
| Times a week | Peloton 3× a week | Only once skipping today would make the weekly goal impossible. Before that it shows under "Also on your list" without locking. |
| Monthly | Health claims on the 1st | From "start locking N days before" until done |
| Yearly dates | Taxes on Apr 15 (add several dates for quarterly payments) | Same as monthly |

Every task also has:
- **Lock apps until done:** turn off for tasks you want reminders for but no lock.
- **Show on list N days before** (monthly/yearly): when it appears.
- **Start locking N days before** (monthly/yearly): when it starts locking.
- **Overdue:** a monthly/yearly task you miss stays on your list (and keeps locking) until you do it.

Apps are unlocked when nothing in "Do these to unlock" is left. Tap a done task to undo it.

## Files

```
App/               → the app target
  TaskLockApp.swift, AppModel.swift, ContentView.swift, TaskEditorView.swift
Shared/            → add to BOTH the app and the extension targets
  TaskModels.swift   (schedules, due/overdue rules)
  SharedStore.swift  (saved data + the lock itself)
MonitorExtension/  → the extension target
  DeviceActivityMonitorExtension.swift (re-locks apps at midnight)
```

## You need
- A Mac with Xcode (iOS 17+ SDK)
- A **paid** Apple Developer Program membership. Apple's free "Personal Team" does not support the Family Controls capability.
- Your iPhone, connected to the Mac. Screen Time features don't work in the Simulator.

## Setup

**1. App target** (skip to step 2 if you already built the first version)
1. Xcode → File → New → Project → iOS → App. Interface: SwiftUI. Language: Swift. Name: TaskLock.
2. Delete Xcode's generated `TaskLockApp.swift` and `ContentView.swift`.
3. Target → General → Minimum Deployments: iOS 17.0.

**2. Add the code to the app**
1. Drag the four files in `App/` into the project (tick "Copy items if needed", target: TaskLock). If you built the first version, replace its three files.
2. Drag the two files in `Shared/` in too.

**3. Add the midnight re-lock extension**
1. File → New → Target → **Device Activity Monitor Extension**. Name it `TaskLockMonitor`. If Xcode asks to activate the scheme, click Activate.
2. Open the `DeviceActivityMonitorExtension.swift` file Xcode created in that folder and replace its contents with `MonitorExtension/DeviceActivityMonitorExtension.swift`.
3. Select each file in `Shared/` → File inspector (right panel) → Target Membership → tick **both** TaskLock and TaskLockMonitor.

**4. Capabilities: do this for BOTH targets** (TaskLock, then TaskLockMonitor)
1. Signing & Capabilities → pick your paid team.
2. "+ Capability" → **Family Controls**.
3. "+ Capability" → **App Groups** → "+" → e.g. `group.com.yourname.tasklock`. Use the same group on both targets.
4. In `Shared/SharedStore.swift`, set `appGroup` to that exact name.

**5. Run**
1. Plug in your iPhone, select it as the run destination, press Run.
2. In the app: allow Screen Time access → Choose apps to lock → tap + to add tasks.

## Strict mode
Off by default. When on, while apps are locked you can't delete or edit tasks, change the locked apps, or turn strict mode off (you can still add tasks). This closes the "just delete the task" loophole. Careful with big monthly/yearly tasks: with strict mode on, an overdue task keeps your apps locked until you check it off.

## Known gaps
- You can always get out by deleting the app or turning off its Screen Time access in iPhone Settings. iOS doesn't let an app prevent that for yourself.
- Checking off a task is on the honor system. Nothing verifies you drank the water.
- Coming from the first version: your old tasks come back as "Every day" tasks, all unchecked.
- No reminder notifications yet. That's a good next addition.
- This code is untested. I couldn't compile it (no Mac/Xcode), so expect to fix small build errors. Paste any errors back to me.
