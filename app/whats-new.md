# What's new in Lactic

Changes riders will notice, newest release first. Each release's section is the "What's new" list in the app's update card and the top of its GitHub release page.

Write for riders: what they can now do or what works better, one short line each, in plain words. Leave out CI, tests, refactors, the website and anything else riders don't see. Add your line under **Next**; the release that bumps the version renames **Next** to the version (`## 0.1.4`) and starts a new empty **Next**.

## Next

- Lactic has a plugin for Claude Code and Cowork, so Claude can coach you from Lactic there too: `/plugin install lactic --marketplace blairj09/lactic`. Claude apps now also see which Lactic tools only read and which suggest a change.
- Sign in with OpenRouter in Settings → Coach instead of copying an API key. Pasting a key still works.
- Coaching in Claude Desktop shows Lactic cards right in the chat: the suggested workout's chart with Apply and Dismiss, a ride's power and heart rate with how each effort went, and your fitness and form.

## 0.3.8

- Coach can now fix events and plans for you: add, move, change or remove an event, or start, change or end a plan. Its card lists the days that change, and nothing changes until you press Apply.
- Lactic keeps your place. Leave Today, Plan, Progress or Health and come back, and it opens where you left it, on the same ride, range and scroll. Settings has a Done button, and clicking the gear again closes it.
- The Ride page shows the coach's suggested ride next to today's plan, so you can pick and start either one there. Overlay and Edit fields now sit next to the ride's time, and the controls no longer repeat "Trainer connected".
- The Coach's brief names the workout it suggests instead of pointing above or below, since you can arrange Today your way.
- On iPhone the ride screen stays clear of the clock and battery at the top, and the Intensity, ERG and Adaptive controls fit across the screen without being cut off.
- The Feedback button has its own label and megaphone icon and sits apart from Coach, so it is harder to hit by mistake.
- When the Coach suggests a workout, its card shows the workout's chart. Hover a part, or tap it on iPhone, to see its length and target.

## 0.3.7

- Took a test drive on lactic.fit? Open Lactic from the finish screen after downloading, and your FTP and that ride come with you.
- When a ride pauses, Resume and End sit side by side (on the ride page, the overlay, the iPhone and lactic.fit/ride), so ending a ride takes one tap.
- On the computer and in the overlay, switch ride pages with ← and →, a two-finger sideways swipe on the trackpad, or by clicking a page dot. Click the overlay first so it hears the keys.
- Customizing ride fields is quicker: click a field and pick what it shows from a searchable list right beside it, with Tab to move to the next field. Layout and page options now sit in one row above the page.
- On the iPhone, the pull-to-refresh logo now stays at the top of the page and scrolls away with it, instead of floating over the page while it loads.
- Today's Recovery card shows your exertion so far today against today's target.
- iPhone: turned sideways, the ride screen now stays clear of the Dynamic Island and rounded corners, and heart rate and cadence no longer hide behind the controls.
- The ride's numbers and timer in the iPhone's Dynamic Island and lock screen no longer flicker as they update, the lock screen shows the real Lactic logo, and the workout's time remaining sits right next to its label.
- Bring your training: Finish setting up now finds Zwift rides on your computer, walks you through downloading your Strava archive (and picks it up from Downloads), and shows what your past rides tell Lactic. Today and Progress offer the same when you have no history yet.

## 0.3.6

- Free ride has an ERG switch: turn it off and the trainer rides like a road, − and + set the grade, and you shift to set your effort.
- The Coach's brief no longer gets stuck on "Writing your brief" when the AI model stops answering: it tries again, then tells you so you can retry or pick another model.
- The Ride tab icon on the phone is now just the interval outline.
- Rides posted to Strava draw cleaner workout art: each set of short efforts is one block, and the line no longer looks ragged. Titles like "30/15s" no longer repeat themselves.
- In Settings → Coach, the model test result now fits inside the card on narrow windows.
- On iPhone, the ride's Live Activity no longer stays on the Lock Screen after you force-quit Lactic.

## 0.3.5

- Connected AI apps show a friendly name, like "Claude connected". Click it to see each app and when it last read your training.

## 0.3.4

- Simpler Settings: pick your coach, AI provider and model from dropdowns, health tracking uses switches, and less-used device actions sit in a ⋯ menu.

## 0.3.3

- After you ride, the Coach's brief on Today becomes a short take on how the ride went and what it means for tomorrow. The morning brief stays below it.
- Strava is no longer an experiment: connect it in Settings → Connections on your computer or iPhone. A paired phone's rides post from your computer.
- iPhone: plugins. Turn on Lactic's own or ones from your computer in Settings → Plugins; their ride fields and ride page sections work on the phone.
- Plugin ride fields can be dials, progress rings, zone bars, target bars, lists, countdowns and more. Try the new Speedometer plugin.
- A plugin field can show several numbers at once, like your best 5 s, 1 min, 5 min and 20 min.
- Any ride field can be wide, filling two slots: choose Wide in the field editor.
- Each plugin in Settings → Plugins has "Report a problem".

## 0.3.2

- Head unit is now part of Free ride. Pick who has the trainer: Lactic, holding the watts you set, or Zwift (or another app) while Lactic records and floats your fields on top. Free ride starts on Zwift when it's open, your head unit fields carry over, and "Start with Zwift" now opens a free ride.
- Rides posted to Strava show the workout's shape as a line of bars, signed "Trained with Lactic · lactic.fit", instead of a list of numbers.
- On iPhone, a ride fills the screen and stays put: the workout map, this interval, ride totals and controls are always in view. Swipe for your field pages and what's up next, or turn the phone sideways for an overlay-style layout. The same screen controls a ride on your computer.
- Pick a workout lists every workout that fits the type, length and level you set, so you can pick one. It no longer swaps in an endurance ride when a type doesn't fit the length.
- Cards side by side on Today, like Form and Last ride, now line up along the bottom.
- Ride screen: the "W under" and "W over" under Power now match the power number shown beside them, with no lag.
- iPhone: opening Lactic while a ride is going on your computer goes straight to its controls.
- iPhone: the lock screen keeps up with a ride on your computer, moving on to each new interval with fresh power and heart rate, instead of getting stuck. Your computer nudges the phone over Bluetooth while the Ride page is open.
- Four new half-hour workouts in the library: Sweet spot 2 × 8, Threshold 3 × 5, VO2 max 6 × 1 and Sprints 8 × 10 s.
- The ride overlay has a button in its top-left corner that closes it and brings Lactic back to the front; the ride keeps going.

## 0.3.1

- Coach's brief on Today shows the brief itself again, not a closing line like "Brief's set. Anything else?".
- Coach's brief is rewritten whenever last night's recovery numbers change, so it always matches the Recovery card.
- Mac: drag the window by its top bar again, and double-click the bar to zoom it.
- Phone: touching a chart on Progress, Plan or Health shows the value at that point instead of zooming in, and a double tap zooms back out. Ride charts still zoom with a drag.
- The built-in coach can search the web for things that change, like gear and prices. Turn it on in Settings → Coach (needs an OpenRouter key); only the search words leave Lactic, and sources show under the reply.
- iPhone: if pairing with your computer fails after the code is scanned, a Pair again button takes you back to scan a fresh code.
- iPhone: Apple Health keeps reading sleep and HRV even when iOS hasn't yet asked about a newer type such as weight, and only one permission sheet shows at a time.

## 0.3.0

- Today no longer suggests a shorter ride when the planned easy ride already fits inside today's exertion target.
- The Ride screen says how a ramp test works: ride until you can't hold the target, then end the ride.
- Windows and Linux: Head unit's "Start with Zwift" says Lactic stays in the system tray, and the coach shortcut shows as Ctrl+K.
- A free ride is saved as "Free ride" instead of taking the name of the day's planned workout.
- If the built-in coach has no model or key yet, the coach says to finish setting it up in Settings → Coach, and setup's coach step asks for them (or No coach) before it counts as done.
- Ask the coach for a ride field or ride page section Lactic doesn't have, and it writes a small plugin for it. You see it running on a sample ride, and its code, before you add it.
- Settings is organized into sections with a menu, and has a search box (⌘F). ⌘, opens Settings from anywhere.
- Today's This week compares rides since your plan started with what it planned, so rides you brought in from before the plan no longer show as "314 of 36 TSS". They still show on their days.
- iPhone: Customize fields now has Head unit, so you can set up the head unit's pages on your phone. The phone remote shows those pages during a head unit ride.
- New riders who don't know their FTP start with an easy ride on day one; the FTP test comes on the next good day.
- Today no longer shows a coach error when the built-in coach has no API key yet; the brief simply stays hidden until the coach is set up.
- iPhone: when Apple Health hasn't been asked about something Lactic reads ("Authorization not determined"), Lactic shows Apple's permission sheet again, and Settings shows Connect Apple Health instead of the error.
- Phones: tap the tab you're on to go back to the top of its page (or back to its main page first).
- iPhone: if Lactic on this iPhone hasn't been given access to Apple Health yet, Today asks you to connect it instead of waiting for last night.
- Settings → iPhone is now Settings → Phone.
- iPhone: pull down on any page to refresh it. Lactic reads Apple Health and syncs with your computer while the logo builds.
- iPhone: Apple Health no longer gets stuck and stops bringing in new nights until you quit the app. "Read Health now" in Settings says what went wrong if a read fails.
- Phone: your coach and intervals.icu API keys now come across from your computer even when a first sync stops partway, and Settings → Phone says why if they don't.
- Every workout in the library shows its shape. Tap one for its page, with each interval's target. Plan has a new Workouts section to browse them, ride one now or add it to a day. In the Ride library, "Back to today's plan" takes you back to the day's workout.
- Setup is now two quick steps, FTP and weight then your trainer, and you're riding. Your week and goal, past rides, sleep and weight, and the coach wait on Today under "Finish setting up".
- High contrast: Settings → Appearance → Contrast. Darker text, clear borders and stronger zone colors, rides and the overlay included. System turns it on with your Mac or iPhone's Increase contrast. Input and toggle borders are a little darker for everyone.
- Plugins add ride fields (on the Ride page, the overlay and head unit rides) and sections on a ride's page. Manage them in Settings → Plugins: Added is where you switch plugins on or off, update them and see each one's details, and Browse lists Lactic's own.
- Open overlay is now a button next to End ride on every ride, workouts, free rides and head unit alike. To open it by itself, tick "Open when a ride starts" under Ride → Setup → Overlay.
- See a plugin before you add it. The add screen shows its ride fields and ride page section drawn from a made-up sample ride, never your own data.
- Head unit says which app controls your trainer, like "Zwift controls the trainer", when Zwift, Rouvy or MyWhoosh is open.
- Head unit can start with Zwift. Tick "Start with Zwift, Rouvy or MyWhoosh" under Head unit (or in Settings → Head unit) and Lactic stays in the menu bar; when one of those apps opens, the Ride page gets the head unit ready and pedaling starts it.
- Head unit on the Ride page. Ride Zwift, Rouvy or any app and Lactic shows your own fields on the overlay, plugins included, and records the ride, without ever touching your trainer. If the trainer only takes one app, Lactic uses your power meter or heart rate instead. Head unit rides aren't posted to Strava automatically, since the other app usually does.
- With the AI app coach turned off, Claude and other AI apps that still list Lactic no longer show a "Couldn't start" error; they see one tool that says how to turn the coach on.
- iPhone: the coach chat stays fitted to the screen after you type, with its title clear of the clock, no gap under the message box, and the keyboard steps aside when you send.
- Settings → Plugins → Browse lists Lactic's own plugins, such as W′ Balance, Best Efforts, Matches, Fuel Reminder and Zones. Add one in two taps. Each is open source, so you can read the code to learn how it works.
- iPhone: hold any Today card to rearrange Today. Drag cards, tap "–" to take one off, tap its size to change it, and add cards back from the bottom. The iPhone starts with your computer's layout and keeps its own after you change it.
- iPhone: set up ride fields on the phone. Tap a field to pick what it shows, choose 1, 2, 4 or 6 big numbers a page, and swipe between pages. When the phone is the remote for a ride on your computer, it shows its own pages.
- iPhone: a new Fields widget for your home or lock screen. Hold it, tap Edit Widget, and pick what each spot shows: recovery, HRV, resting heart rate, sleep, form, fitness, fatigue, FTP, today's ride, this week's time or rides, or weight.
- Make Today yours: "Customize Today" at the bottom of Today lets you drag cards into any order, make them small, medium or large, and take off the ones you don't want (they wait in "Add a card"). Undo, Cancel and Reset are always there. Reorder or hide tabs in Settings → Layout.
- Add plugins from a GitHub link or a .lacticplugin file in Settings → Plugins. You see what each one reads before it's added, switch it on or off per computer, and choose whether the coach sees its numbers. Updates are only offered, never automatic. Plugins can add a section to a ride's page, but never show up on Today.
- Plugin ride fields can draw a small live chart under the number, such as time-in-zone bars, a trend line or a gauge. The Zones example plugin adds HR zones, Power zones and Power, last 5 min.
- Plugin ride fields. In Customize fields, pick one from the Plugins group and it shows on the ride screen, the overlay and the iPhone, marked with a small purple square. If a plugin is slow or stops, its field shows "–" and your ride carries on.
- Choose your ride screen's numbers, like on a bike computer. Before a ride, press Customize fields to pick a layout (the usual screen, or 1, 4, 6 with the chart, 8 or 10 big numbers), tap a field to choose what it shows, and add pages you flip through with ← → or a swipe while riding. Make your own fields with no code, like 10-second power, % of FTP, this interval's average, or your best 15-second (or any length) power so far in the ride. Free rides, the overlay over Zwift and the iPhone follow the same pages unless you set them up separately.
- Ask the coach where something is and it answers from your own layout. Ask it to move a Today card, hide a tab or add a ride field and it offers the change with an Apply button; it adds rather than swaps unless you ask. Plugins you share with the coach show it numbers only, and it never installs or recommends plugins.
- Weigh-ins from other scales in Apple Health now come into Lactic on iPhone and keep your profile weight current, and weigh-ins from your Body Pod or typed into Lactic are saved to Apple Health when "Save rides and weigh-ins to Health" is on.
- Pairing an iPhone you've been using on its own with a computer that already has a plan now also brings across the events, breaks, race reports and check-ins you added on the phone. The computer's plan for the days ahead stays as it is.
- On iPhone, your ride shows on the lock screen and in the Dynamic Island: the interval under way with its countdown, power against target, heart rate, cadence, what's next and time left. It shows for rides on the iPhone and, while Lactic is open on it, for a ride on your computer too.
- If the connection drops while the coach writes today's brief, Lactic tries again on its own, and shows Try again instead of "error decoding response body".
- Rest days on Today have a new illustration: your bike parked for the night under the moon and stars.
- Before your first ride, Today shows one line about where your fitness numbers come from instead of form, fitness and fatigue at zero. The Plan page's warning about your hours limiting the build now only shows if you picked a faster pace than the default, and says it in plain words.
- Today: This week's day tiles are shorter, and a ride that made up a session moved from another day now shows its ride shape instead of just its TSS.
- Your plan starts the day you set Lactic up: the first week's rides fit into the days left in it. If there's nothing planned that day, Today offers an easy 30-minute first ride to try your trainer.
- iPhone: during a ride, pause, skip, intensity and End ride stay docked above the tabs, so you never scroll to reach them.
- Today puts the key things first. Recovery is four quick tiles (HRV, resting HR, breathing, sleep), each with a bar showing your usual range and a dot for last night. Then "Ready to train?" and Indoors or Outside, then today's plan next to the suggested ride, each with its own Start ride. "Something else…" offers today's other options, the library, your own workouts or a free ride. The coach's brief comes after, and it's rewritten if your recovery score changes a lot after it was written.
- A new plan no longer starts with a recovery week when you set it up partway through a week, so your first week has real riding in it. Riders without a coach or sleep tracking no longer see lines about them after a ride or on Progress.
- The coach's message box no longer shrinks to a sliver after you delete old conversations and start a new one.
- Warm-ups now open the legs: before tempo, sweet spot and harder workouts, the 10-minute warm-up is a 6-minute build and three short efforts, each a little harder than the last (20 s at 110, 120 and 130% before hard days; 30 s at 90, 100 and 110% before tempo and sweet spot). Workouts stay the same length; endurance and recovery rides keep the plain build. This week's plan picks them up too.
- A coach brief written before the brief-and-suggestion fix is written once more, so today's brief and the option marked under it agree. With Adaptive workouts on, the brief may mention that Lactic eases later reps for you during the ride.
- New experiment, adaptive workouts (turn it on in Settings → Experimental features): if a workout is clearly too hard, say your cadence fades at the end of a rep or your heart rate won't come down between reps, Lactic eases the reps still to come by a few percent and offers Undo. If it looks too easy, it asks before making them harder, and no answer keeps the plan. It never changes the rep you're in, tests or race openers. The ride's page shows what changed and why.
- Today's coach brief and the suggested option under it now always agree: if the coach says ride it as planned, that's what's marked, and when a later recovery score changes the advice, the brief is rewritten. The coach also no longer offers to change a workout mid-ride; it points you to an easier option before you start, or the intensity and skip buttons while you ride.
- Warm-ups now finish at the power of your first interval and cool-downs start at the power of your last, so there's no jump or drop where they meet. Hard first efforts still start with a step up. Edit the first interval and the warm-up follows it.
- Sleep: the coach no longer quotes a weekly sleep debt total. Like Today, it tells you how much to aim for tonight. iPhone: Health reads no longer start partway through a night, so a night can't be cut down to its last few minutes, and older nights are read again once to fix any that were.
- Today is about today: your workout first, then how this week and your plan are tracking, your form and your recovery. Rest days get a proper rest-day card. Last week's review moved to the top of Progress.
- Weighing in is now weekly: Today only asks before your first ride of the week, and only when there's no weigh-in from the last 7 days (scale, typed in, or Apple Health). You can type your weight in right there, or put it off until next week.
- The Last night card on Today and Health is now called Recovery.
- Race courses: set a target finish time and Lactic works out the FTP it takes, whether that's realistic by race day, and the power to hold on each climb to make it. If you need more FTP, the plan builds toward it. Pick how you'll ride the event (solo, a small group or a bunch) and times allow for the draft, with what getting dropped on the main climb would cost you.
- Race courses: times now show a likely range, and allow for racing at altitude (Lactic asks where you live) and in the heat. Fueling follows the current sports-nutrition guidelines. Curious how it's all worked out? Settings → About links to the science behind it.
- Race courses: road riders can measure their own drag from recent outdoor rides with power (via intervals.icu). Lactic then checks itself by timing each of those rides from its own power, and tells you how close it came.
- On a computer, Ride is now a tab in the top bar between Plan and Progress, and it stays highlighted while you're on it, so you can always tell where you are.
- The iPhone screen stays on while it's showing a ride, whether the iPhone is running the trainer or showing the ride on your computer.
- iPhone: rides no longer show up twice in Apple Health and Fitness, and rides that were saved twice before are cleaned up (Lactic keeps one copy).
- Favorites now count everywhere: workouts you've saved yourself can go into your plan too, the AI coach can suggest and pick workouts from the library and your own (favorites first), and the coach's weekly picks no longer replace a favorite the plan already chose.
- Plan: the day popup's "Use a workout…" menu now lists your favorites and your own workouts above the library. Your plan also mixes in workouts from the library that fit, alongside its own, with your favorites first.

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
