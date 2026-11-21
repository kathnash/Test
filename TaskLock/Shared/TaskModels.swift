import Foundation

// Shared by the app and the Device Activity Monitor extension.
// Foundation only, so it has no UI or Screen Time dependencies.

/// A month and day, e.g. April 15. The year is ignored.
struct MonthDay: Codable, Hashable, Comparable {
    var month: Int  // 1–12
    var day: Int    // 1–31

    static func < (a: MonthDay, b: MonthDay) -> Bool {
        (a.month, a.day) < (b.month, b.day)
    }
}

/// How often a task comes around.
enum Frequency: Codable, Hashable {
    /// Every day (pills, water).
    case daily
    /// On fixed weekdays. Calendar weekday numbers: 1 = Sunday … 7 = Saturday.
    case weekdays(Set<Int>)
    /// Any N days a week (core workout 3× a week). Only locks when you'd fall behind.
    case timesPerWeek(Int)
    /// Once a month on this day. 31 means the last day in shorter months.
    case monthly(day: Int)
    /// On one or more dates every year (taxes, quarterly payments).
    case yearly([MonthDay])

    var isPeriodic: Bool {
        switch self {
        case .monthly, .yearly: return true
        default: return false
        }
    }
}

struct TaskItem: Identifiable, Codable, Equatable {
    var id = UUID()
    var title: String
    var frequency: Frequency = .daily
    /// If false, the task shows on your list but never locks apps.
    var locksApps = true
    /// Monthly/yearly only: how many days before the due date it appears on your list.
    var showDaysBefore = 0
    /// Monthly/yearly only: how many days before the due date it starts locking apps.
    var lockDaysBefore = 0
    /// When you checked it off. Kept for about a year.
    var completions: [Date] = []
    var createdAt = Date()
}

extension TaskItem {
    /// Tolerates data saved by the first version of TaskLock (which only had id, title, isDone).
    /// Those tasks come back as daily tasks.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        title = try c.decode(String.self, forKey: .title)
        frequency = try c.decodeIfPresent(Frequency.self, forKey: .frequency) ?? .daily
        locksApps = try c.decodeIfPresent(Bool.self, forKey: .locksApps) ?? true
        showDaysBefore = try c.decodeIfPresent(Int.self, forKey: .showDaysBefore) ?? 0
        lockDaysBefore = try c.decodeIfPresent(Int.self, forKey: .lockDaysBefore) ?? 0
        completions = try c.decodeIfPresent([Date].self, forKey: .completions) ?? []
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? .distantPast
    }
}

// MARK: - Status

struct TaskStatus {
    enum Bucket: Int {
        /// Due now and locking apps.
        case locking
        /// On today's list, but not locking (ahead of pace, or set not to lock).
        case open
        /// Done for now.
        case done
        /// Not due yet.
        case later
    }

    var bucket: Bucket
    var detail: String?

    var locks: Bool { bucket == .locking }
}

extension TaskItem {
    func isDone(on now: Date, calendar cal: Calendar = .current) -> Bool {
        completions.contains { cal.isDate($0, inSameDayAs: now) }
    }

    /// Where this task stands at `now`. Everything is worked out from the completion
    /// history, so there's no "reset" step that has to run each day.
    func status(on now: Date, calendar cal: Calendar = .current) -> TaskStatus {
        let doneToday = isDone(on: now, calendar: cal)
        let dueBucket: TaskStatus.Bucket = locksApps ? .locking : .open

        switch frequency {
        case .daily:
            return TaskStatus(bucket: doneToday ? .done : dueBucket)

        case .weekdays(let days):
            let weekday = cal.component(.weekday, from: now)
            guard days.contains(weekday) else {
                return TaskStatus(bucket: .later, detail: nextWeekdayText(days, after: now, cal))
            }
            return TaskStatus(bucket: doneToday ? .done : dueBucket)

        case .timesPerWeek(let target):
            guard let week = cal.dateInterval(of: .weekOfYear, for: now) else {
                return TaskStatus(bucket: dueBucket)
            }
            let count = completions.filter { $0 >= week.start && $0 < week.end }.count
            let progress = "\(min(count, target))/\(target) this week"
            if count >= target || doneToday {
                return TaskStatus(bucket: .done, detail: progress)
            }
            let remaining = target - count
            let today = cal.startOfDay(for: now)
            // Days left in the week, counting today.
            let daysLeft = cal.dateComponents([.day], from: today, to: week.end).day ?? 1
            if remaining >= daysLeft {
                // Skipping today would make the weekly goal impossible.
                return TaskStatus(bucket: dueBucket, detail: progress + " · today keeps you on track")
            }
            return TaskStatus(bucket: .open, detail: progress)

        case .monthly, .yearly:
            return periodicStatus(now: now, cal: cal)
        }
    }

    private func periodicStatus(now: Date, cal: Calendar) -> TaskStatus {
        let today = cal.startOfDay(for: now)
        let created = cal.startOfDay(for: createdAt)
        let occurrences = occurrenceDates(around: today, cal: cal)
        let lastDone = completions.max()

        // A completion counts for a due date if it happened once that due date was on your list.
        func windowStart(_ due: Date) -> Date {
            cal.date(byAdding: .day, value: -max(showDaysBefore, lockDaysBefore), to: due) ?? due
        }
        func isSatisfied(_ due: Date) -> Bool {
            guard let lastDone else { return false }
            return lastDone >= windowStart(due)
        }

        // Missed the last due date (and it was after you created the task)? It's overdue.
        if let previous = occurrences.last(where: { $0 < today }),
           previous >= created,
           !isSatisfied(previous) {
            return TaskStatus(bucket: locksApps ? .locking : .open,
                              detail: "Overdue since \(previous.shortText)")
        }

        guard let next = occurrences.first(where: { $0 >= today }) else {
            return TaskStatus(bucket: .later)
        }
        let showFrom = windowStart(next)
        let lockFrom = cal.date(byAdding: .day, value: -lockDaysBefore, to: next) ?? next
        let dueText = next == today ? "Due today" : "Due \(next.shortText)"

        if today < showFrom {
            return TaskStatus(bucket: .later, detail: dueText)
        }
        if isSatisfied(next) {
            return TaskStatus(bucket: .done, detail: dueText)
        }
        if locksApps && today >= lockFrom {
            return TaskStatus(bucket: .locking, detail: dueText)
        }
        let lockNote = locksApps ? " · locks apps from \(lockFrom.shortText)" : ""
        return TaskStatus(bucket: .open, detail: dueText + lockNote)
    }

    /// Due dates (at start of day) from roughly a year back to a year ahead, sorted.
    private func occurrenceDates(around today: Date, cal: Calendar) -> [Date] {
        let year = cal.component(.year, from: today)
        let month = cal.component(.month, from: today)
        var dates: [Date] = []

        switch frequency {
        case .monthly(let day):
            guard let thisMonth = cal.date(from: DateComponents(year: year, month: month, day: 1)) else { break }
            for offset in -2...2 {
                guard let firstOfMonth = cal.date(byAdding: .month, value: offset, to: thisMonth),
                      let date = clampedDate(firstOfMonth: firstOfMonth, day: day, cal: cal)
                else { continue }
                dates.append(date)
            }
        case .yearly(let monthDays):
            for y in (year - 1)...(year + 1) {
                for md in monthDays {
                    guard let firstOfMonth = cal.date(from: DateComponents(year: y, month: md.month, day: 1)),
                          let date = clampedDate(firstOfMonth: firstOfMonth, day: md.day, cal: cal)
                    else { continue }
                    dates.append(date)
                }
            }
        default:
            break
        }
        return Array(Set(dates)).sorted()
    }

    /// The given day in that month, or the month's last day if it's shorter (Feb 30 → Feb 28/29).
    private func clampedDate(firstOfMonth: Date, day: Int, cal: Calendar) -> Date? {
        let daysInMonth = cal.range(of: .day, in: .month, for: firstOfMonth)?.count ?? 28
        let clamped = min(max(day, 1), daysInMonth)
        return cal.date(byAdding: .day, value: clamped - 1, to: firstOfMonth).map(cal.startOfDay(for:))
    }

    private func nextWeekdayText(_ days: Set<Int>, after now: Date, _ cal: Calendar) -> String? {
        for offset in 1...7 {
            guard let date = cal.date(byAdding: .day, value: offset, to: now) else { continue }
            if days.contains(cal.component(.weekday, from: date)) {
                return offset == 1 ? "Next: tomorrow" : "Next: \(cal.weekdaySymbols[cal.component(.weekday, from: date) - 1])"
            }
        }
        return nil
    }
}

// MARK: - Labels

extension Frequency {
    var summary: String {
        let cal = Calendar.current
        switch self {
        case .daily:
            return "Every day"
        case .weekdays(let days):
            let ordered = orderedWeekdays(cal).filter { days.contains($0) }
            return ordered.map { cal.shortWeekdaySymbols[$0 - 1] }.joined(separator: ", ")
        case .timesPerWeek(let n):
            return "\(n)× a week"
        case .monthly(let day):
            return "Monthly on the \(day.ordinal)" + (day >= 29 ? " (or last day)" : "")
        case .yearly(let dates):
            return "Yearly: " + dates.sorted().map(\.text).joined(separator: ", ")
        }
    }
}

/// Weekday numbers starting from the user's first day of the week.
func orderedWeekdays(_ cal: Calendar = .current) -> [Int] {
    (0..<7).map { (cal.firstWeekday - 1 + $0) % 7 + 1 }
}

extension MonthDay {
    /// "Apr 15". Uses a leap year so Feb 29 formats correctly.
    var text: String {
        let comps = DateComponents(year: 2000, month: month, day: day)
        guard let date = Calendar.current.date(from: comps) else { return "\(month)/\(day)" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

extension Date {
    var shortText: String { formatted(.dateTime.month(.abbreviated).day()) }
}

extension Int {
    var ordinal: String {
        let f = NumberFormatter()
        f.numberStyle = .ordinal
        return f.string(from: NSNumber(value: self)) ?? "\(self)"
    }
}
