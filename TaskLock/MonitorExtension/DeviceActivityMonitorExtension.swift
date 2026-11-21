import DeviceActivity
import ManagedSettings

// Runs in the background (iOS wakes it; TaskLock doesn't need to be open).
// TaskLock schedules a daily window from 00:00 to 23:59. When it starts at midnight,
// this re-checks your tasks and re-locks apps for the new day.
//
// Keep the class name the same as the one in the Xcode template, because the
// extension's Info.plist points at it.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        SharedStore.applyShieldFromSavedData()
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        SharedStore.applyShieldFromSavedData()
    }
}
