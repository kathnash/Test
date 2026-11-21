import SwiftUI

/// Add or edit a task and its schedule.
struct TaskEditorView: View {
    enum Kind: String, CaseIterable, Identifiable {
        case daily = "Every day"
        case weekdays = "Certain days"
        case perWeek = "Times a week"
        case monthly = "Monthly"
        case yearly = "Yearly dates"
        var id: Self { self }
    }

    @Environment(\.dismiss) private var dismiss
    private let original: TaskItem?
    private let onSave: (TaskItem) -> Void

    @State private var title: String
    @State private var kind: Kind
    @State private var weekdays: Set<Int>
    @State private var perWeek: Int
    @State private var monthDay: Int
    @State private var yearlyDates: [MonthDay]
    @State private var newYearlyDate = Date()
    @State private var locksApps: Bool
    @State private var showDaysBefore: Int
    @State private var lockDaysBefore: Int

    init(task: TaskItem?, onSave: @escaping (TaskItem) -> Void) {
        original = task
        self.onSave = onSave
        let t = task ?? TaskItem(title: "")
        _title = State(initialValue: t.title)
        _locksApps = State(initialValue: t.locksApps)
        _showDaysBefore = State(initialValue: t.showDaysBefore)
        _lockDaysBefore = State(initialValue: t.lockDaysBefore)

        var kind = Kind.daily, weekdays: Set<Int> = [2, 4, 6], perWeek = 3, monthDay = 1
        var yearly: [MonthDay] = []
        switch t.frequency {
        case .daily: kind = .daily
        case .weekdays(let d): kind = .weekdays; weekdays = d
        case .timesPerWeek(let n): kind = .perWeek; perWeek = n
        case .monthly(let d): kind = .monthly; monthDay = d
        case .yearly(let d): kind = .yearly; yearly = d
        }
        _kind = State(initialValue: kind)
        _weekdays = State(initialValue: weekdays)
        _perWeek = State(initialValue: perWeek)
        _monthDay = State(initialValue: monthDay)
        _yearlyDates = State(initialValue: yearly)
    }

    private var isPeriodic: Bool { kind == .monthly || kind == .yearly }

    private var canSave: Bool {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        switch kind {
        case .weekdays: return !weekdays.isEmpty
        case .yearly: return !yearlyDates.isEmpty
        default: return true
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Task, e.g. Take pills", text: $title)
                }

                Section("How often") {
                    Picker("Repeats", selection: $kind) {
                        ForEach(Kind.allCases) { Text($0.rawValue).tag($0) }
                    }
                    scheduleDetails
                }

                Section {
                    Toggle("Lock apps until done", isOn: $locksApps)
                    if isPeriodic {
                        Stepper("Show on list: \(daysText(showDaysBefore))",
                                value: $showDaysBefore, in: 0...(kind == .monthly ? 27 : 180))
                        if locksApps {
                            Stepper("Start locking: \(daysText(lockDaysBefore))",
                                    value: $lockDaysBefore, in: 0...showDaysBefore)
                        }
                    }
                } footer: {
                    Text(footerText)
                }
            }
            .navigationTitle(original == nil ? "New task" : "Edit task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(!canSave)
                }
            }
            .onChange(of: showDaysBefore) { _, value in
                lockDaysBefore = min(lockDaysBefore, value)
            }
        }
    }

    @ViewBuilder
    private var scheduleDetails: some View {
        switch kind {
        case .daily:
            EmptyView()

        case .weekdays:
            HStack {
                ForEach(orderedWeekdays(), id: \.self) { day in
                    let on = weekdays.contains(day)
                    Button(Calendar.current.veryShortWeekdaySymbols[day - 1]) {
                        if on { weekdays.remove(day) } else { weekdays.insert(day) }
                    }
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .background(on ? Color.accentColor : Color.secondary.opacity(0.15), in: Circle())
                    .foregroundStyle(on ? Color.white : Color.primary)
                    .buttonStyle(.plain)
                }
            }

        case .perWeek:
            Stepper("\(perWeek) time\(perWeek == 1 ? "" : "s") a week", value: $perWeek, in: 1...7)

        case .monthly:
            Stepper("On the \(monthDay.ordinal)", value: $monthDay, in: 1...31)

        case .yearly:
            ForEach(yearlyDates, id: \.self) { date in
                Text(date.text)
            }
            .onDelete { yearlyDates.remove(atOffsets: $0) }
            HStack {
                DatePicker("Add date", selection: $newYearlyDate, displayedComponents: .date)
                Button("Add") {
                    let c = Calendar.current.dateComponents([.month, .day], from: newYearlyDate)
                    let md = MonthDay(month: c.month ?? 1, day: c.day ?? 1)
                    if !yearlyDates.contains(md) { yearlyDates.append(md); yearlyDates.sort() }
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private var footerText: String {
        switch kind {
        case .daily, .weekdays:
            return locksApps ? "Locks apps each day it's due until you check it off." : "Shows on your list but never locks apps."
        case .perWeek:
            return "Never forces you on a particular day. It only locks apps once skipping today would make the weekly goal impossible."
        case .monthly, .yearly:
            return "Picking a year for a date doesn't matter; it repeats every year. If a due date passes without it being done, it stays on your list as overdue."
        }
    }

    private func daysText(_ n: Int) -> String {
        n == 0 ? "on the due date" : "\(n) day\(n == 1 ? "" : "s") before"
    }

    private func save() {
        var task = original ?? TaskItem(title: "")
        task.title = title.trimmingCharacters(in: .whitespaces)
        switch kind {
        case .daily: task.frequency = .daily
        case .weekdays: task.frequency = .weekdays(weekdays)
        case .perWeek: task.frequency = .timesPerWeek(perWeek)
        case .monthly: task.frequency = .monthly(day: monthDay)
        case .yearly: task.frequency = .yearly(yearlyDates)
        }
        task.locksApps = locksApps
        task.showDaysBefore = isPeriodic ? showDaysBefore : 0
        task.lockDaysBefore = isPeriodic && locksApps ? lockDaysBefore : 0
        onSave(task)
        dismiss()
    }
}
