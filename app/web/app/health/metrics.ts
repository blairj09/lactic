// The Health detail views (and Progress's VO2 max view): which ones there are, their titles and what each metric means.

export const METRICS = {
  recovery: {
    title: "Recovery",
    line: "How ready your body is today, scored against your own last 60 days.",
    about: [
      "Recovery compares this morning with your own normal, not with other people. HRV is the biggest part (half the weight): it's compared on a log scale against your last 60 nights. Resting heart rate counts 30%, with a higher pulse scoring lower. Sleep against your need counts 20%, and breathing rate 10%, since it rises when you're run down or getting ill.",
      "Once daytime heart rate comes in from Apple Health, yesterday's exertion against your normal day counts another 10%: a big day costs up to 2 points of the weighted mean, an easy one gives back up to 1. Wrist temperature doesn't change the score; it's shown beside it as a warning sign.",
      "50 is a normal day for you. 67 and up reads as recovered, below 34 as under-recovered. The score needs 14 nights of HRV before it starts.",
    ],
  },
  exertion: {
    title: "Exertion",
    line: "How hard the whole day was on your heart, rides and everything else, 0 to 10.",
    about: [
      "Exertion adds up every minute of heart rate in the day with Banister's TRIMP, which weights a minute more the higher your heart rate sits in its reserve (between resting and max). Inside a ride, the ride's own heart rate wins over the watch. The total goes onto a 0 to 10 scale that flattens out at the top, so a long hard ride reads about 7 to 8 and a quiet day 1 to 2.",
      "Your normal is the mean of the last 28 days that had at least 8 hours of heart rate, once there are 7 of them. Today's target moves from your normal with your recovery: about 0.4 per 10 points either side of 50.",
    ],
  },
  "sleep-score": {
    title: "Sleep score",
    line: "Each night out of 100: how long, how solid, how restorative and how regular.",
    about: [
      "Duration against your sleep need is half the score. Efficiency (time asleep of time in bed, full marks from 95%) counts 20%. Deep plus REM as a share of sleep counts 20%, with full marks at 40%, about what adults average. Regularity counts 10%: how close your bedtime sits to your usual one over the last two weeks, full marks within 15 minutes.",
      "Parts with no data drop out and the rest are reweighted. Sleep debt is the shortfall over the last 7 nights, with extra sleep paying it back at half rate; tonight's need adds a third of the debt and a little after a big day, at most 1.5 hours.",
    ],
  },
  hrv: {
    title: "HRV",
    line: "Heart rate variability asleep, the biggest part of recovery.",
    about: [
      "HRV is the small variation in time between heartbeats. When you're rested your nervous system varies it more; stress, hard training, alcohol, illness and poor sleep all bring it down. Your own trend matters, not the number against anyone else's.",
      "Apple Watch measures SDNN in short readings through the night, which runs differently from the RMSSD a chest strap gives, so the two are never compared with each other. Your normal is the geometric mean of the last 60 nights.",
    ],
  },
  "resting-hr": {
    title: "Resting HR",
    line: "Your lowest steady heart rate, from Apple Health.",
    about: [
      "Resting heart rate falls as aerobic fitness builds and rises with fatigue, heat, alcohol, dehydration or illness. A few beats above your normal for more than a day or two is worth noticing.",
      "Your normal is the mean of the last 60 days. It counts 30% of the recovery score, and it sets the bottom of your heart rate reserve for exertion.",
    ],
  },
  sleep: {
    title: "Sleep",
    line: "Hours asleep each night, with the stages Apple Watch records.",
    about: [
      "Hours asleep don't count time awake in bed. Apple Watch splits sleep into core (light), deep and REM. Deep sleep does most of the physical repair and comes early in the night; REM comes later and matters for memory and mood. Adults typically spend about 40% of sleep in deep plus REM.",
      "Sleep against your need counts 20% of recovery. You can change your sleep need in Settings.",
    ],
  },
  breathing: {
    title: "Breathing rate",
    line: "Breaths per minute while asleep.",
    about: [
      "Breathing rate asleep is very steady for most people, so a rise of a breath a minute or more over your normal often comes before you feel run down or ill. It counts 10% of recovery, with a higher rate scoring lower.",
      "Your normal is the mean of the last 60 nights, once there are 7.",
    ],
  },
  "wrist-temp": {
    title: "Wrist temperature",
    line: "Overnight wrist temperature against your own normal.",
    about: [
      "Apple Watch measures wrist temperature while you sleep. Only the change against your own normal means anything, since the raw reading depends on the room and the bedding. A rise of 0.5 °C (0.9 °F) or more can mean illness, heavy training load, alcohol or a hot room.",
      "It doesn't change the recovery score; when it's 0.3 °C (0.5 °F) or more off your normal, the score shows it beside the reasons.",
    ],
  },
  fitness: {
    title: "VO2 max and fitness age",
    line: "Your aerobic ceiling, estimated from your power.",
    about: [
      "VO2 max is the most oxygen your body can use, in millilitres per kilo per minute. It's estimated with the ACSM cycling equation, 10.8 × watts per kilo + 7, using your best 5 minutes of power in the last 90 days as the power at VO2 max. Real lab values can differ by a few points either way, but the trend is reliable as long as you ride hard 5-minute efforts now and then.",
      "Fitness age is the age whose average VO2 max matches yours, from the HUNT fitness study of about 4,600 healthy Norwegians (Loe et al., 2013). Apple Watch's own Cardio Fitness estimate is shown beside it when Health sends one; it comes from walks and runs, so it usually reads lower for cyclists.",
    ],
  },
  body: {
    title: "Body",
    line: "Weight and body composition from the Body Pod.",
    about: [
      "Weight moves a kilo or more day to day with water, food and glycogen, so the trend over weeks is what counts. Weigh in at the same time each day, before a ride, for the cleanest line.",
      "Body fat is estimated from impedance (Sun et al., 2003) with your height, age and sex. It moves with hydration too, so a single reading can be off by a couple of points; lean mass is weight less fat.",
    ],
  },
} as const satisfies Record<string, { title: string; line: string; about: readonly string[] }>;

export type MetricKey = keyof typeof METRICS;

export const isMetric = (key: string): key is MetricKey => Object.hasOwn(METRICS, key);

export const RANGES = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
] as const;
export const DEFAULT_RANGE = 90;

/** The `?days=` value, kept to the offered ranges. */
export function rangeFrom(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return RANGES.some((r) => r.days === n) ? n : DEFAULT_RANGE;
}

/** Where each detail view lives. VO2 max is training fitness, so it opens from Progress. */
export const metricPath = (key: MetricKey) => (key === "fitness" ? "/progress/vo2max" : `/health/${key}`);

export const metricHref = (key: MetricKey, days?: number) => `${metricPath(key)}${days && days !== DEFAULT_RANGE ? `?days=${days}` : ""}`;
