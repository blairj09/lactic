# What's new in Lactic

Changes riders will notice, newest release first. Each release's section is the "What's new" list in the app's update card and the top of its GitHub release page.

Write for riders: what they can now do or what works better, one short line each, in plain words. Leave out CI, tests, refactors, the website and anything else riders don't see. Add your line under **Next**; the release that bumps the version renames **Next** to the version (`## 0.1.4`) and starts a new empty **Next**.

## Next

- Race courses: set a target finish time and Lactic works out the FTP it takes, whether that's realistic by race day, and the power to hold on each climb to make it. If you need more FTP, the plan builds toward it. Pick how you'll ride the event (solo, a small group or a bunch) and times allow for the draft, with what getting dropped on the main climb would cost you.
- Race courses: times now show a likely range, and allow for racing at altitude (Lactic asks where you live) and in the heat. Fueling follows the current sports-nutrition guidelines. Curious how it's all worked out? Settings → About links to the science behind it.
- Race courses: road riders can measure their own drag from recent outdoor rides with power (via intervals.icu). Lactic then checks itself by timing each of those rides from its own power, and tells you how close it came.
- On a computer, Ride is now a tab in the top bar between Plan and Progress, and it stays highlighted while you're on it, so you can always tell where you are.
- The iPhone screen stays on while it's showing a ride, whether the iPhone is running the trainer or showing the ride on your computer.

## 0.2.0

- Post rides to Strava from the iPhone app (an experiment): connect Strava in Settings on an iPhone you use on its own, or, if it's paired with your computer, rides you record on the iPhone go to Strava from your computer once they sync, so none shows up twice.
- Sleep debt is fixed: reading Health from your iPhone could keep only the last hour or two of some nights, which made sleep debt far too high. The iPhone reads your last 60 days once more to put those nights back, and debt now counts only the last 7 days.
- Today no longer shows a weekly sleep debt warning. When you're behind on sleep it just says how long to aim for tonight to catch up; the week's total is still on the Sleep page.
- Three iPhone widgets to choose from: Today (recovery and your ride together, now also in a large size), Recovery (last night only) and Ride (today's workout, tomorrow's and your week). If you don't track sleep, Today shows your ride and week instead of an empty ring.
- Today puts your workout and Start ride first, with this morning's recovery beside it on a computer and right below it on a phone. The full Last night card now lives at the top of Health, and both pages use the same words: "usual" for your own ranges, one way of writing hours, and sleep shown as a share of your need.
- Progress works out W/kg in the power profile from your latest weigh-in, the same weight VO2 max uses, and weigh-ins from intervals.icu now keep your profile weight up to date too.
- Today no longer offers to lower your FTP when your recent rides didn't include a hard enough effort; it only offers a new number when rides say FTP has gone up.
- Your plan's first week no longer counts rides from before the plan started, or shows them making up a planned session.
- Rides named for a workout, like "Sweet spot 3 × 12", now show that type in your rides list instead of a guess from intensity, and ride sources read properly: Zwift, not "zwift".
- Zoom Lactic in and out with Cmd + and Cmd − (Ctrl on Windows and Linux), and back to normal size with Cmd 0.
- The tour no longer asks twice: choosing "Show me around" after setup, or "Take the tour" in Settings, goes straight to the first stop. Its list of what's not set up yet no longer suggests choosing a coach once you've picked one, No coach included.
- On a phone, the Health page's tiles no longer leave empty grey gaps, and choices with long names (like "Garmin, Oura, WHOOP") wrap instead of running into each other.
- Setting up Lactic on an iPhone without a computer now talks about your iPhone, connects Apple Health in its own step, and leaves out the options that need a computer (local AI models, AI apps, Strava).
- The iPhone remote keeps Pause, Skip and Intensity at the bottom of the screen within reach of your thumb, and Intensity moves in 5% steps.
- While your computer is riding, the iPhone's Ride tab opens the remote for that ride instead of trying to connect to the trainer.
- Import rides from GPX and TCX files as well as FIT, on their own or inside a zip like Strava's account archive, so older Strava rides come in too.
- Import .erg and .mrc workout files (from TrainerRoad, Golden Cheetah and others) on the Ride screen, alongside .zwo.
- Save any workout as a file from the Ride screen: a .fit workout to copy onto a Garmin (or open in another head unit or app), or a .zwo for Zwift and most trainer apps. No intervals.icu needed.
- Pick a workout is simpler: choose the type, style and length from three menus, and make it easier or harder with one Level − / + control. The library and your saved workouts sit behind one link.
- On the iPhone, the coach panel and pop-up windows no longer slide under the clock and battery at the top or the home bar at the bottom.
- If your iPhone widgets stay empty, they now say why, and the iPhone app's settings show when they last updated, with a button to update them now.
- Lactic on your Apple Watch: last night's recovery, HRV, resting heart rate, sleep and today's ride in the Watch app, plus a Smart Stack widget and complications for your watch face. Your iPhone sends them over whenever it updates.
- Lactic widgets for your iPhone's home screen and lock screen: last night's recovery score, HRV, resting heart rate and sleep, today's ride and today's exertion against its target, at a glance. They update whenever the app reads Health or syncs with your computer.
- Your saved keys are now tied to the service they're for: the intervals.icu key only goes to intervals.icu, the Strava sign-in only to Strava, and the coach's AI key only to your AI provider. If you use a custom provider and change its address, your computer asks before the key is used there.
- Pairing your iPhone is safer: the QR code now only starts the pairing, and your iPhone and computer agree on their own private key that was never on screen. A photo or screen recording of the code can't be used to read what they send each other. Pair again once both are updated to get the new key.
- Lactic stays responsive while it reads a long ride history, makes a backup or waits on the keychain, and lists of rides load faster because they no longer pull every ride's full power and route data.
- Today has a new Last night card: your recovery score with the past week, HRV, resting heart rate, sleep, breathing, wrist temperature and yesterday's exertion over the last two weeks against your usual range, last night's sleep stages, and a bar showing today's exertion against today's target (and where your planned ride should land it).
- Today's options and the coach now notice patterns across nights, not just last night: HRV under your usual range three nights running, signs you may be getting ill, or a pile of sleep debt make an easier day the suggestion, and the coach keeps them in mind when it picks the week's workouts.
- Chart dates and times no longer pile up on a phone: the fitness forecast, power curve, ride and race charts show fewer axis labels when the screen is narrow.
- Each block of a workout is now its own lap on Strava and intervals.icu, with its own time and average power, so you can see how every interval went. Rides you post or export again from their ride page get laps too.
- With your iPhone paired, Settings → Sleep and recovery shows Apple Health coming from it, when the phone last read Health and last night's numbers. Without a paired iPhone, the card points you to pairing it, and the Shortcut steps sit behind a "No iPhone app yet?" link.
- Your API keys (the coach's AI key and intervals.icu) now move between your Mac and paired iPhone, so you type each one once; change or remove one on either and the other follows. Keys go only over the direct encrypted link and stay in each device's keychain. Units and your ride habits (auto-start, sprint grade, how Extend works) sync too, and a post-ride survey or week review you skipped on one isn't asked again on the other. Theme and paired gear stay per device.
- Away from your Mac, your iPhone keeps syncing through iCloud: your rides and Health data reach the Mac next time Lactic is open there.
- Your iPhone finds Lactic on your Mac nearby by itself and connects straight to it, the way AirDrop does, even when the two are on different networks.
- When your iPhone can't reach your computer, it now says why, including when the two are on different networks.
- The ride overlay opens where you left it, at the size you left it, every ride and after restarting Lactic. If that screen isn't connected anymore, it opens on one that is.
- Stretch the ride overlay short and wide and its end-of-workout choices fit on one row, with bigger Extend and End buttons.
- The ride overlay's buttons work again in the desktop app: Extend and End at the end of a workout, and back, pause and skip in its controls, did nothing when pressed there.
- Ask coach buttons (beside a sensor or intervals.icu problem) now start a new coach conversation instead of adding to the one you were in.
- Progress has two tabs: Trends for your fitness and power charts, and Rides for every ride on a calendar or as a list, with search and filters. Your rides are no longer under all the charts.
- Race reports (experimental): in the week after a race on your plan, Today points you to its report, and every race report now opens with an automatic look at the race: your peak power and W/kg against your bests of the last 90 days, where you placed once the results are in (gap to the winner, the podium and the riders either side), your earlier rides of the same course, found on their own from your history, and, when the event has a course, how you rode it against your pre-race plan, climb by climb. On races that aren't laps, line any of those up with one click.
- New experiment: race courses. Turn on "Race courses" in Settings → Experimental features, then find your race by name when you add an event (US races on BikeReg; Lactic picks up its Ride with GPS course when the listing links one), or attach a course file (GPX, TCX or FIT) or paste a course link. You get a pre-race report with the profile, each climb and the power to hold on it, your estimated time, fueling, and the forecast with the wind on the course from two weeks out. The plan's key workouts also train for the course's climbs.
- New experiment: post rides to Strava. Turn on "Post rides to Strava" in Settings → Experimental features, connect Strava under Connections, and rides you record in Lactic show on Strava as Lactic activities, titled with the workout and described with how each interval went. Earlier rides get a Post to Strava button on their ride page.
- Lactic for iPhone (coming to TestFlight): pair it with Lactic on your Mac by scanning a code in Settings → iPhone, and the two stay in sync over your Wi-Fi, with your Mac keeping the main copy. It reads sleep, HRV and resting heart rate straight from Apple Health, so the Shortcut isn't needed, and saves your Lactic rides to Health as cycling workouts.
- With Lactic's Ride page open on your Mac, your paired iPhone shows a bar to control the ride from your bars: start and pause, skip, intensity, ERG, extend and end.
- Riding with your iPhone as the remote: when the workout reaches its end, your iPhone (and Apple Watch) gets a notification with buttons to extend the ride with your Extend pick or end it, right from the lock screen. Opening the app at the end shows all the Extend options.
- Started on your iPhone? Pair a new Mac from its welcome screen (Bring it from your iPhone) and your plan, rides and settings move across. Pair with a Mac that already has Lactic and the rides from your iPhone join it.
- Lactic on an iPhone without a computer can connect intervals.icu itself.
- Dragging a workout onto another day on the Plan calendar now moves it (it did nothing in the Mac app).
- Apple Watch riders: the Lactic Shortcut now has a step-by-step guide, linked from Sleep and recovery setup. It saves your sleep, HRV and resting heart rate from your iPhone to iCloud Drive each morning, free, with no extra app.
- Fixed a crash on some ride pages ("undefined is not an object … _leaflet_pos") that came back after a reload. If the route map ever has trouble now, it shows a note and the rest of the ride page keeps working.

## 0.1.5

- Lactic for Mac is now signed and checked by Apple, so it installs like any other app with no Terminal step, and it runs on Intel Macs too. Your Mac may ask once more for permission to use Lactic's saved keys; choose Always Allow and it remembers it from then on, across updates.
- Moving to a new computer? Back up in Settings → Your data, copy the file across, and choose "Bring your data across" when Lactic first opens on the new one (or Restore from a backup in Your data). Rides, plan, workouts, favorites, recovery, coach chats and settings all come with you; you add your API keys and pair your gear again, and Lactic lists what's left.
- On Windows and Linux, the ride overlay now keeps itself on top when a game or video goes full screen. If a game in exclusive full screen still covers it, the Ride page's Overlay settings explain how to switch the game to borderless or windowed (and how to pin the overlay on Wayland).
- Experimental features in Settings: new things we're still trying out, off until you turn them on. The first is Race reports: open a race from its ride page, add other riders' files and the results, and see where you lost time, corner by corner and lap by lap, what to work on, and a debrief from the coach.
- Race reports now work for long races that aren't laps, like LoToJa or a gran fondo, even with nobody to compare with. Lactic cuts the course into its climbs and the roads between, and shows how you paced it, where you faded, your power once tired, what each climb took, your stops and what you rode between them (with how much to eat). Add your ride from another year and see where you gained or lost on it.
- Don't know your FTP? Tick "I don't know" in setup and your plan starts with a ramp test on your first good day. When you finish it, Lactic sets your FTP from the result (with Undo), so every workout after it fits you.
- No smart scale? Today no longer shows a Weigh in step. It appears once you pair a scale in Settings → Bluetooth or on Health.
- Starting over or moving on? Settings → Your data → Delete all my data removes every ride, plan, setting and saved key from this computer, after offering an export first.
- Rides that reached intervals.icu through Strava can't come into Lactic, because Strava doesn't let intervals.icu share them. Settings → intervals.icu now says how many are missing and how to bring them in, and Import FIT files takes Strava's account archive .zip.
- A starter workout library: 50 workouts for recovery, endurance, tempo, sweet spot, threshold, VO2 max, anaerobic and sprints, plus a ramp test and a 20-minute FTP test. Find it under Ride → Pick a workout → My workouts, or put one on any plan day.
- Heart the workouts you like, in the library or after a ride, and find them under Favorites. When a favorite fits a key day, the plan picks it.
- Disconnecting intervals.icu now removes its API key from your computer too. A key pasted in Settings also goes into your system keychain now, not the database.
- Two races on one weekend? The plan now keeps both, with openers before the first, instead of turning Saturday's race into an openers ride.
- Your week stays put. Lactic keeps the week as it was planned on Monday instead of reshuffling it as rides come in, and if your fitness has moved enough to change it by more than 15%, the Plan offers a Re-plan button rather than changing it quietly. Easier days now say why, like Recovery week or Fresh for your event.
- Numbers now say where they came from: measured (a test or your scale), estimated by Lactic from your rides, or synced from Apple Health or intervals.icu, with the date. Look under FTP in Settings and the tiles on Health and Progress.
- Take your data anywhere: each ride's page has Export FIT for Garmin Connect, Strava or any training app, and Settings → Your data → Export everything saves all your rides, plan, recovery, weight and coach chats in one zip. And your AI key now has a Remove button in Settings → Coach.
- When your rides say your FTP has gone up, Today offers to use the new number, with Undo if you change your mind. And when your last FTP test is over eight weeks old, one click puts a ramp test on the next good day.
- Each ride now gets an execution score out of 100. Rides on Lactic are checked block by block, so you can see which interval you cut short or faded in. Rides from elsewhere are scored on time and stress against the plan.
- Using Claude or another AI app as your coach? Click the coach button in the top bar (or press ⌘K) to see that you chat with it there, whether it's connected and what to ask. The built-in coach can now let AI apps connect too, in Settings → Coach.
- Missed a key workout? Lactic moves it to the next open day that week, shortened if that day is shorter, and never right next to another hard day or just before a race. The Plan shows where it went.
- When something in Lactic frustrates you or you ask for a feature it doesn't have, the coach offers a Send feedback button with your note already written up. Check it, change it, and send it if you like.
- The tour now shows the Send feedback button and how to include a marked-up screenshot.
- Only ride and plan? Setup now asks whether you want sleep and recovery, weight, both or neither, and Lactic hides what you skip. Not ready? Set them up later in Settings → What you track, or ask the coach.
- Today's Recovery step names where your sleep comes from, like Connect Apple Health or Connect intervals.icu, instead of asking for a watch.
- Lactic is in beta: you'll see a Beta tag next to the name. Expect a few rough edges, and tell us what you find with Send feedback.
- Like Lactic? Settings → About now has a Support Lactic link if you want to chip in.
- A new startup screen: the Lactic logo builds one interval at a time each time you open the app, then fades into Today.
- Weigh in on many more smart scales: Xiaomi Mi scales, Renpho and other QN scales, Etekcity ESF-551 and scales with the standard Bluetooth weight profile, as well as the Hume Body Pod.
- Feedback no longer screenshots on its own. Press Include screenshot to take one, circle the problem, then attach it.
- Fewer Mac keychain password prompts: your API keys now share one keychain entry, so Lactic asks at most once after each update.

## 0.1.4

- Feedback now attaches a picture of the screen you're on, ready to circle the problem. Remove it or add your own images if you like.

## 0.1.3

- Lactic now tells you when there's a new version and installs it for you with one click, then shows what changed.
- Check for updates any time from the Lactic menu on a Mac, or Settings → About.
