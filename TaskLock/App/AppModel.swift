import SwiftUI
import FamilyControls
import DeviceActivity

@MainActor
final class AppModel: ObservableObject {
    @Published var tasks: [TaskItem] {
        didSet { SharedStore.saveTasks(tasks); applyShield() }
    }
    @Published var selection: FamilyActivitySelection {
        didSet { SharedStore.saveSelection(selection); applyShield() }
    }
    /// When on, you can't delete or edit tasks, change the locked apps,
    /// or turn strict mode off while apps are locked.
    @Published var strictMode: Bool {
        didSet { SharedStore.strictMode = strictMode }
    }
    @Published var authorized: Bool
    @Published var errorMessage: String?
    /// The moment statuses are worked out for. Refreshed when the app opens and at midnight.
    @Published private(set) var now = Date()

    init() {
        SharedStore.migrateFromFirstVersion()
        tasks = SharedStore.loadTasks()
        selection = SharedStore.loadSelection()
        strictMode = SharedStore.strictMode
        authorized = AuthorizationCenter.shared.authorizationStatus == .approved
        applyShield()
        if authorized { startDailyMonitor() }
    }

    var hasSelection: Bool { SharedStore.hasSelection(selection) }

    var isLocked: Bool {
        SharedStore.shouldLock(tasks: tasks, selection: selection, now: now)
    }

    /// Strict mode only bites while apps are locked.
    var editingBlocked: Bool { strictMode && isLocked }

    func status(of task: TaskItem) -> TaskStatus { task.status(on: now) }

    /// Call when the app comes to the foreground or the day changes.
    func refresh() {
        now = Date()
        applyShield()
    }

    // MARK: - Screen Time permission

    func requestAuthorization() async {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            authorized = AuthorizationCenter.shared.authorizationStatus == .approved
            if authorized { startDailyMonitor() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Locking

    private func applyShield() {
        SharedStore.applyShield(tasks: tasks, selection: selection, now: Date())
    }

    /// Asks iOS to wake the extension every midnight so apps re-lock without opening TaskLock.
    private func startDailyMonitor() {
        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59),
            repeats: true
        )
        do {
            try DeviceActivityCenter().startMonitoring(.daily, during: schedule)
        } catch {
            errorMessage = "Couldn't schedule the midnight re-lock: \(error.localizedDescription)"
        }
    }

    // MARK: - Tasks

    func toggle(_ task: TaskItem) {
        guard let i = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        let cal = Calendar.current
        if tasks[i].isDone(on: now) {
            tasks[i].completions.removeAll { cal.isDate($0, inSameDayAs: now) }
        } else if status(of: tasks[i]).bucket == .done, !tasks[i].completions.isEmpty {
            // Done earlier (e.g. this month's claim filed last week): undo the latest one.
            tasks[i].completions.removeLast()
        } else {
            tasks[i].completions.append(Date())
        }
        now = Date()
    }

    func save(_ task: TaskItem) {
        if let i = tasks.firstIndex(where: { $0.id == task.id }) {
            tasks[i] = task
        } else {
            tasks.append(task)
        }
    }

    func delete(_ task: TaskItem) {
        tasks.removeAll { $0.id == task.id }
    }
}
