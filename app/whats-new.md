# What's new in Lactic

Changes riders will notice, newest release first. Each release's section is the "What's new" list in the app's update card and the top of its GitHub release page.

Write for riders: what they can now do or what works better, one short line each, in plain words. Leave out CI, tests, refactors, the website and anything else riders don't see. Add your line under **Next**; the release that bumps the version renames **Next** to the version (`## 0.1.4`) and starts a new empty **Next**.

## Next

- Race reports (experimental): in the week after a race on your plan, Today points you to its report, and every race report now opens with an automatic look at the race: your peak power and W/kg against your bests of the last 90 days, where you placed once the results are in (gap to the winner, the podium and the riders either side), your earlier rides of the same course, found on their own from your history, and, when the event has a course, how you rode it against your pre-race plan, climb by climb. On races that aren't laps, line any of those up with one click.
- New experiment: race courses. Turn on "Race courses" in Settings → Experimental features, then find your race by name when you add an event (US races on BikeReg; Lactic picks up its Ride with GPS course when the listing links one), or attach a course file (GPX, TCX or FIT) or paste a course link. You get a pre-race report with the profile, each climb and the power to hold on it, your estimated time, fueling, and the forecast with the wind on the course from two weeks out. The plan's key workouts also train for the course's climbs.
- New experiment: post rides to Strava. Turn on "Post rides to Strava" in Settings → Experimental features, connect Strava under Connections, and rides you record in Lactic show on Strava as Lactic activities, titled with the workout and described with how each interval went.
- Dragging a workout onto another day on the Plan calendar now moves it (it did nothing in the Mac app).
- Apple Watch riders: the Lactic Shortcut now has a step-by-step guide, linked from Sleep and recovery setup. It saves your sleep, HRV and resting heart rate from your iPhone to iCloud Drive each morning, free, with no extra app.

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
