import Foundation
import FamilyControls
import ManagedSettings
import DeviceActivity

// Shared by the app and the Device Activity Monitor extension.
// Both read the same saved data through an App Group, and both write the same named shield.

enum SharedStore {
    /// ⚠️ Change this to the App Group you create in Xcode (Signing & Capabilities → App Groups).
    /// It must be identical in the app target and the extension target.
    static let appGroup = "group.com.example.tasklock"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    /// A named store, so the app and the extension change the same shield.
    static let shieldStore = ManagedSettingsStore(named: ManagedSettingsStore.Name("TaskLock"))

    // MARK: Saved data

    static func loadTasks() -> [TaskItem] {
        guard let data = defaults.data(forKey: "tasks"),
              let tasks = try? JSONDecoder().decode([TaskItem].self, from: data)
        else { return [] }
        return tasks
    }

    static func saveTasks(_ tasks: [TaskItem]) {
        // Drop completions older than ~13 months; nothing looks back further than that.
        let cutoff = Calendar.current.date(byAdding: .month, value: -13, to: Date()) ?? .distantPast
        let trimmed = tasks.map { task -> TaskItem in
            var t = task
            t.completions.removeAll { $0 < cutoff }
            return t
        }
        if let data = try? JSONEncoder().encode(trimmed) {
            defaults.set(data, forKey: "tasks")
        }
    }

    static func loadSelection() -> FamilyActivitySelection {
        guard let data = defaults.data(forKey: "selection"),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        else { return FamilyActivitySelection() }
        return selection
    }

    static func saveSelection(_ selection: FamilyActivitySelection) {
        if let data = try? JSONEncoder().encode(selection) {
            defaults.set(data, forKey: "selection")
        }
    }

    static var strictMode: Bool {
        get { defaults.bool(forKey: "strictMode") }
        set { defaults.set(newValue, forKey: "strictMode") }
    }

    /// The first version saved to the app's own defaults and used the unnamed shield.
    /// Move that data over once, and clear the old shield so it can't linger.
    static func migrateFromFirstVersion() {
        guard !defaults.bool(forKey: "migratedV2") else { return }
        let old = UserDefaults.standard
        if defaults.data(forKey: "tasks") == nil, let data = old.data(forKey: "tasks") {
            defaults.set(data, forKey: "tasks")
        }
        if defaults.data(forKey: "selection") == nil, let data = old.data(forKey: "selection") {
            defaults.set(data, forKey: "selection")
        }
        ManagedSettingsStore().clearAllSettings()
        defaults.set(true, forKey: "migratedV2")
    }

    // MARK: Locking

    static func hasSelection(_ s: FamilyActivitySelection) -> Bool {
        !s.applicationTokens.isEmpty || !s.categoryTokens.isEmpty || !s.webDomainTokens.isEmpty
    }

    static func shouldLock(tasks: [TaskItem], selection: FamilyActivitySelection, now: Date) -> Bool {
        hasSelection(selection) && tasks.contains { $0.status(on: now).locks }
    }

    static func applyShield(tasks: [TaskItem], selection: FamilyActivitySelection, now: Date = Date()) {
        guard shouldLock(tasks: tasks, selection: selection, now: now) else {
            shieldStore.clearAllSettings()
            return
        }
        shieldStore.shield.applications =
            selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
        shieldStore.shield.applicationCategories =
            selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
        shieldStore.shield.webDomains =
            selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
    }

    /// Used by the extension, which has no model of its own.
    static func applyShieldFromSavedData() {
        applyShield(tasks: loadTasks(), selection: loadSelection())
    }
}

extension DeviceActivityName {
    /// Runs every day so the extension can re-lock apps at midnight.
    static let daily = DeviceActivityName("TaskLock.daily")
}
