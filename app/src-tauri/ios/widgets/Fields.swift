// The Fields widget: two to four of Lactic's numbers, picked by the rider with Edit Widget (hold the
// widget). The app words every number (web/lib/widget-snapshot.ts, `fields`); this only lays out
// the ones picked. Lactic's own numbers only: plugins never show on widgets.

import AppIntents
import SwiftUI
import WidgetKit

/// What a slot can show. The raw values are the snapshot's field keys.
enum FieldChoice: String, AppEnum {
  case recovery, hrv, restingHr, sleep, form, fitness, fatigue, ftp, today, week, rides, weight

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "Field" }
  static var caseDisplayRepresentations: [FieldChoice: DisplayRepresentation] {
    [
      .recovery: "Recovery", .hrv: "HRV", .restingHr: "Resting HR", .sleep: "Sleep",
      .form: "Form", .fitness: "Fitness", .fatigue: "Fatigue", .ftp: "FTP",
      .today: "Today's ride", .week: "This week", .rides: "Rides this week", .weight: "Weight",
    ]
  }

  var label: String {
    switch self {
    case .recovery: "Recovery"
    case .hrv: "HRV"
    case .restingHr: "Resting HR"
    case .sleep: "Sleep"
    case .form: "Form"
    case .fitness: "Fitness"
    case .fatigue: "Fatigue"
    case .ftp: "FTP"
    case .today: "Today"
    case .week: "This week"
    case .rides: "Rides"
    case .weight: "Weight"
    }
  }

  /// Last night's or today's: shown only on the day the app wrote them.
  var daily: Bool { [.recovery, .hrv, .restingHr, .sleep, .today].contains(self) }
}

struct FieldsIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource { "Fields" }
  static var description: IntentDescription { IntentDescription("Pick the numbers this widget shows.") }

  @Parameter(title: "Field 1", default: .recovery) var field1: FieldChoice
  @Parameter(title: "Field 2", default: .form) var field2: FieldChoice
  @Parameter(title: "Field 3", default: .week) var field3: FieldChoice
  @Parameter(title: "Field 4", default: .hrv) var field4: FieldChoice

  var choices: [FieldChoice] { [field1, field2, field3, field4] }
}

struct FieldsEntry: TimelineEntry {
  let date: Date
  let snapshot: Snapshot?
  let current: Bool
  let choices: [FieldChoice]
}

struct FieldsProvider: AppIntentTimelineProvider {
  static let defaults: [FieldChoice] = [.recovery, .form, .week, .hrv]

  func placeholder(in context: Context) -> FieldsEntry {
    FieldsEntry(date: Date(), snapshot: .sample, current: true, choices: Self.defaults)
  }

  func snapshot(for configuration: FieldsIntent, in context: Context) async -> FieldsEntry {
    if context.isPreview { return FieldsEntry(date: Date(), snapshot: .sample, current: true, choices: configuration.choices) }
    return entry(at: Date(), Store.load(), configuration.choices)
  }

  func timeline(for configuration: FieldsIntent, in context: Context) async -> Timeline<FieldsEntry> {
    let now = Date()
    let snapshot = Store.load()
    let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
    // As the other widgets: the app reloads them when it has something new; past midnight the day's numbers go.
    return Timeline(entries: [entry(at: now, snapshot, configuration.choices), entry(at: midnight, snapshot, configuration.choices)], policy: .after(midnight.addingTimeInterval(3_600)))
  }

  private func entry(at date: Date, _ snapshot: Snapshot?, _ choices: [FieldChoice]) -> FieldsEntry {
    FieldsEntry(date: date, snapshot: snapshot, current: snapshot.map { $0.day == Store.day(date) } ?? false, choices: choices)
  }
}

struct FieldsView: View {
  @Environment(\.widgetFamily) var family
  let entry: FieldsEntry

  /// A slot's label, value and unit; "–" when there's nothing (yet) for it.
  func shown(_ choice: FieldChoice) -> (label: String, value: String, unit: String) {
    let field = entry.snapshot?.fields?.first { $0.key == choice.rawValue }
    guard let field, !(choice.daily && !entry.current) else { return (choice.label, "–", "") }
    return (field.label, field.value, field.unit)
  }

  var body: some View {
    switch family {
    case .accessoryCircular:
      let f = shown(entry.choices[0])
      VStack(spacing: 0) {
        Text(f.value).font(.system(.title3, design: .rounded).weight(.semibold)).minimumScaleFactor(0.5).lineLimit(1)
        Text(f.label).font(.system(size: 9)).lineLimit(1)
      }
      .containerBackground(for: .widget) { AccessoryWidgetBackground() }
    case .accessoryInline:
      let f = shown(entry.choices[0])
      Text("\(f.label) \(f.value)\(f.unit.isEmpty ? "" : " \(f.unit)")")
    case .accessoryRectangular:
      VStack(alignment: .leading, spacing: 2) {
        ForEach(0..<2, id: \.self) { i in
          let f = shown(entry.choices[i])
          HStack(alignment: .firstTextBaseline) {
            Text(f.label).font(.caption).lineLimit(1)
            Spacer(minLength: 4)
            Text(f.value).font(.headline).lineLimit(1).minimumScaleFactor(0.6)
          }
        }
      }
      .containerBackground(for: .widget) { Color.clear }
    case .systemMedium:
      Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
        GridRow {
          cell(entry.choices[0])
          cell(entry.choices[1])
        }
        GridRow {
          cell(entry.choices[2])
          cell(entry.choices[3])
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
    default:
      VStack(alignment: .leading, spacing: 10) {
        cell(entry.choices[0])
        cell(entry.choices[1])
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
    }
  }

  func cell(_ choice: FieldChoice) -> some View {
    let f = shown(choice)
    return VStack(alignment: .leading, spacing: 1) {
      Text(f.label).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(f.value).font(.system(.title2, design: .rounded).weight(.bold)).lineLimit(1).minimumScaleFactor(0.5)
        if !f.unit.isEmpty {
          Text(f.unit).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct FieldsWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "LacticFields", intent: FieldsIntent.self, provider: FieldsProvider()) { entry in
      FieldsView(entry: entry)
    }
    .configurationDisplayName("Fields")
    .description("The numbers you pick. Hold the widget, then Edit Widget.")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}
