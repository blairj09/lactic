# The Lactic Shortcut for Apple Health

Apple Health lives only on your iPhone, so Lactic can't read it directly. This free Shortcut reads your sleep, HRV, resting heart rate, breathing rate, wrist temperature, heart rate, active energy, steps and VO2 max from Health and saves them as one file in **iCloud Drive/Lactic**. Lactic on your computer picks the file up, works out each night and day, and moves it into `Imported`.

Nothing goes anywhere but your own iCloud Drive. It takes about 10 minutes to build, once. If you'd rather not build it, [Health Auto Export](https://www.healthyapps.dev) can save the same data to that folder for you (its file export needs the paid version).

## Before you start

- In Lactic, open **Settings → Sleep and recovery** (or Sleep and recovery during setup), pick **Apple Watch**, and check it shows the folder. Lactic creates `iCloud Drive/Lactic` on your Mac. Give it a minute to appear in the Files app on your iPhone.
- On Windows, install iCloud for Windows with iCloud Drive on. On Linux, or if you'd rather not use iCloud, choose a folder your iPhone also syncs to (Dropbox, Google Drive, Nextcloud) and save there instead.

## Build it

Open **Shortcuts** on your iPhone, tap **+**, and name the shortcut **Lactic**.

### 1. Read your Health data

Add **Find Health Samples** where **Type** is **Sleep** (not Sleep Changes), **Start Date** is **in the last 3 days**, sorted by **Start Date**, **Oldest First**, no limit. Then add **Set Variable** named `Sleep`.

Do the same for each of these, each with its own **Set Variable**:

| Type | Variable |
| --- | --- |
| Heart Rate Variability | `HRV` |
| Resting Heart Rate | `RestingHR` |
| Respiratory Rate | `RespRate` |
| Wrist Temperature (called Sleeping Wrist Temperature on some iOS versions) | `WristTemp` |
| Heart Rate | `HeartRate` |
| Active Energy (Group By Day, if offered) | `ActiveEnergy` |
| Steps (Group By Day, if offered) | `Steps` |
| VO2 Max (Cardio Fitness) | `VO2Max` |

Only the first three are needed for a recovery score. Skip any type your phone doesn't have.

There are no Repeat loops: each field below holds a whole list, and Lactic pairs them back up. That keeps even 60 days down to seconds.

### 2. Put it in one file

Add a **Dictionary** action. Add each key below as **Text**. For each value, insert the variable, tap it, and pick the property. For every date, tap the variable again and set **Date Format** to **ISO 8601** with **Include ISO 8601 Time** on.

| Key | Value |
| --- | --- |
| `sleepStart` | Sleep → Start Date |
| `sleepEnd` | Sleep → End Date |
| `sleepValue` | Sleep → Value |
| `hrvDate` | HRV → Start Date |
| `hrvValue` | HRV → Value |
| `restingHrDate` | RestingHR → Start Date |
| `restingHrValue` | RestingHR → Value |
| `respRateDate` | RespRate → Start Date |
| `respRateValue` | RespRate → Value |
| `wristTempStart` | WristTemp → Start Date |
| `wristTempEnd` | WristTemp → End Date |
| `wristTempValue` | WristTemp → Value (°F or °C both work) |
| `heartRateDate` | HeartRate → Start Date |
| `heartRateValue` | HeartRate → Value |
| `activeEnergyDate` | ActiveEnergy → Start Date |
| `activeEnergyValue` | ActiveEnergy → Value |
| `stepsDate` | Steps → Start Date |
| `stepsValue` | Steps → Value |
| `vo2maxDate` | VO2Max → Start Date |
| `vo2maxValue` | VO2Max → Value |
| `hrvKind` | `sdnn` (typed in; Apple Watch measures HRV as SDNN) |

Leave out the keys for any type you skipped.

### 3. Save it to iCloud Drive/Lactic

1. Add **Set Name**: set the name of **Dictionary** to `lactic-health.json`.
2. Add **Save File**: save **Renamed Item**, turn **Ask Where to Save** off, choose **iCloud Drive → Lactic** as the destination, and turn **Overwrite If File Exists** on.

### 4. Try it

Run the shortcut and allow it to read Health when asked. On your computer, open Lactic's Sleep and recovery setup and click **Check now**. It should say something like `Imported 3 nights. Latest 2026-11-09: 7.2 h asleep, HRV 52 ms`.

If it says it couldn't read the file, open `iCloud Drive/Lactic/lactic-health.json` and check every key from step 2 holds a list of values (one per line), with dates like `2026-11-09T06:41:12-07:00`.

### 5. Fill in your history

Your recovery score needs about two weeks of nights to learn your normal. To bring them in now, change every **Find Health Samples** to **in the last 60 days** (Heart Rate, Active Energy and Steps to **14 days**, since heart rate is a lot of samples), run the shortcut once, click **Check now** in Lactic, then set them all back to **3 days**.

### 6. Run it every morning

In Shortcuts, open **Automation**, tap **+**, and add:

- **Sleep → Waking Up**, set to **Run Immediately**, running the **Lactic** shortcut.
- A second one at a fixed **Time of Day** (say 9:00), also **Run Immediately**, in case Waking Up doesn't fire.

Lactic checks the folder on its own whenever it's open, so the morning's numbers are there when you sit down to ride.
