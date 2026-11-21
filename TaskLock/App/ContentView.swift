import SwiftUI
import FamilyControls

struct ContentView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Group {
                if model.authorized {
                    MainListView()
                } else {
                    onboarding
                }
            }
            .navigationTitle("TaskLock")
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.refresh() }
        }
        // If the app is open at midnight, roll over to the new day.
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
            model.refresh()
        }
    }

    private var onboarding: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.shield")
                .font(.system(size: 56))
            Text("Lock your distracting apps until your tasks are done.")
                .multilineTextAlignment(.center)
            Button("Allow Screen Time access") {
                Task { await model.requestAuthorization() }
            }
            .buttonStyle(.borderedProminent)
            if let error = model.errorMessage {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
        .padding()
    }
}

private struct MainListView: View {
    @EnvironmentObject var model: AppModel
    @State private var editing: TaskItem?
    @State private var addingTask = false
    @State private var showPicker = false
    @State private var pendingDelete: TaskItem?

    private struct Row: Identifiable {
        let task: TaskItem
        let status: TaskStatus
        var id: UUID { task.id }
    }

    private func rows(in bucket: TaskStatus.Bucket) -> [Row] {
        model.tasks
            .map { Row(task: $0, status: model.status(of: $0)) }
            .filter { $0.status.bucket == bucket }
    }

    var body: some View {
        List {
            statusSection

            taskSection("Do these to unlock", bucket: .locking)
            taskSection("Also on your list", bucket: .open)
            taskSection("Done", bucket: .done)
            taskSection("Coming up", bucket: .later)

            if model.tasks.isEmpty {
                Section {
                    Text("No tasks yet. Tap + to add one.")
                        .foregroundStyle(.secondary)
                }
            }

            settingsSection
        }
        .toolbar {
            Button { addingTask = true } label: { Image(systemName: "plus") }
        }
        .sheet(isPresented: $addingTask) {
            TaskEditorView(task: nil) { model.save($0) }
        }
        .sheet(item: $editing) { task in
            TaskEditorView(task: task) { model.save($0) }
        }
        .familyActivityPicker(isPresented: $showPicker, selection: $model.selection)
        .confirmationDialog(
            "Delete \"\(pendingDelete?.title ?? "")\"?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let task = pendingDelete { model.delete(task) }
                pendingDelete = nil
            }
        } message: {
            Text("Its history is deleted too.")
        }
    }

    // MARK: Sections

    private var statusSection: some View {
        Section {
            if !model.hasSelection {
                Label("No apps chosen yet, so nothing is locked", systemImage: "lock.open")
                    .foregroundStyle(.secondary)
            } else if model.isLocked {
                let count = rows(in: .locking).count
                Label("Apps locked · \(count) task\(count == 1 ? "" : "s") to go",
                      systemImage: "lock.fill")
                    .foregroundStyle(.red)
            } else {
                Label("Apps unlocked", systemImage: "lock.open.fill")
                    .foregroundStyle(.green)
            }
            if let error = model.errorMessage {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private func taskSection(_ title: String, bucket: TaskStatus.Bucket) -> some View {
        let items = rows(in: bucket)
        if !items.isEmpty {
            Section(title) {
                ForEach(items) { row in
                    TaskRow(task: row.task, status: row.status) { model.toggle(row.task) }
                        .swipeActions {
                            if !model.editingBlocked {
                                Button("Delete", role: .destructive) { pendingDelete = row.task }
                                Button("Edit") { editing = row.task }.tint(.blue)
                            }
                        }
                        .contextMenu {
                            if !model.editingBlocked {
                                Button("Edit") { editing = row.task }
                                Button("Delete", role: .destructive) { pendingDelete = row.task }
                            }
                        }
                }
            }
        }
    }

    private var settingsSection: some View {
        Section {
            Button("Choose apps to lock") { showPicker = true }
                .disabled(model.editingBlocked)
            Text("\(model.selection.applicationTokens.count) apps, \(model.selection.categoryTokens.count) categories, \(model.selection.webDomainTokens.count) websites")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Toggle("Strict mode", isOn: $model.strictMode)
                .disabled(model.editingBlocked)
        } header: {
            Text("Settings")
        } footer: {
            Text("Strict mode: while apps are locked, you can't delete or edit tasks, change the locked apps, or turn strict mode off. You can still add tasks.")
        }
    }
}

private struct TaskRow: View {
    let task: TaskItem
    let status: TaskStatus
    let toggle: () -> Void

    private var isDone: Bool { status.bucket == .done }
    private var canCheck: Bool { status.bucket != .later }

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 12) {
                Image(systemName: canCheck ? (isDone ? "checkmark.circle.fill" : "circle") : "calendar")
                    .font(.title3)
                    .foregroundStyle(isDone ? Color.green : Color.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title)
                        .strikethrough(isDone)
                    Text([task.frequency.summary, status.detail].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if status.locks {
                    Image(systemName: "lock.fill").foregroundStyle(.red)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canCheck)
    }
}
