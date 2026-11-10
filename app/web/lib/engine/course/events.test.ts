import { describe, expect, it } from "vitest";
import { bikeRegDate, findCourseLinks, kindFromTypes, parseBikeRegSearch, rwgpsTrack } from "./events";

// Shaped like BikeReg's /api/search answer.
const answer = {
  CompletionTime: 0,
  MatchingEvents: [
    {
      Categories: [
        { CategoryName: "Cat 3", Distance: "62 miles", StartTime: "08:15:00" },
        { CategoryName: "Cat 1/2", Distance: "84 miles", StartTime: "07:30:00" },
        { CategoryName: "Volunteer", Distance: "   ", StartTime: "00:00:00" },
      ],
      EventCity: "Ogden",
      EventDate: "/Date(1813298400000-0600)/",
      EventEndDate: "/Date(1813298400000-0600)/",
      EventId: 70001,
      EventName: "Wasatch Hills Road Race",
      EventNotes: '<p>Course: <a href="https://ridewithgps.com/routes/4567890?privacy_code=x">Ride with GPS map</a> and <a href="https://www.strava.com/routes/123">Strava</a></p>',
      EventPermalink: "http://www.BikeReg.com/70001",
      EventState: "UT",
      EventTypes: ["Road Race"],
      EventWebsite: "https://example.org/",
      Latitude: 41.2,
      Longitude: -111.9,
    },
    { EventId: 70002, EventName: "Old crit", EventDate: "/Date(1600000000000-0500)/", EventTypes: ["Criterium"] },
  ],
};

describe("event search", () => {
  it("reads BikeReg dates in the event's own time zone", () => {
    expect(bikeRegDate("/Date(1768021200000-0500)/")).toBe("2026-01-10");
    expect(bikeRegDate("nope")).toBeNull();
  });

  it("maps event types to kinds", () => {
    expect(kindFromTypes(["Cyclocross"])).toBe("cyclocross");
    expect(kindFromTypes(["Mountain Bike", "Bike Tour"])).toBe("mountainBike");
    expect(kindFromTypes(["Gravel Grinder"])).toBe("gravel");
    expect(kindFromTypes(["Gran Fondo"])).toBe("granFondo");
    expect(kindFromTypes(["Time Trial"])).toBe("timeTrial");
    expect(kindFromTypes(["Road Race"])).toBe("roadRace");
  });

  it("keeps upcoming events with their earliest start and distances", () => {
    const [e, ...rest] = parseBikeRegSearch(answer, "2026-11-10");
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ id: 70001, name: "Wasatch Hills Road Race", kind: "roadRace", startTime: "07:30", city: "Ogden", state: "UT", lat: 41.2, url: "https://www.BikeReg.com/70001" });
    expect(e.distances).toEqual(["62 miles", "84 miles"]);
  });

  it("finds course links, Ride with GPS first, without its query string", () => {
    const links = findCourseLinks(answer.MatchingEvents[0].EventNotes as string);
    expect(links.map((l) => l.kind)).toEqual(["rwgps", "strava"]);
    expect(links[0]).toMatchObject({ url: "https://ridewithgps.com/routes/4567890", label: "Ride with GPS map" });
    const site = findCourseLinks('<a href="/files/course-2026.gpx">Course GPX</a> see https://ridewithgps.com/routes/4567890', "https://example.org/race/");
    expect(site.map((l) => l.url)).toEqual(["https://ridewithgps.com/routes/4567890", "https://example.org/files/course-2026.gpx"]);
  });

  it("reads a Ride with GPS route", () => {
    const t = rwgpsTrack({ route: { name: "Wasatch", track_points: [{ x: -111.9, y: 41.2, e: 1300 }, { x: -111.89, y: 41.21, e: 1310 }] } });
    expect(t.name).toBe("Wasatch");
    expect(t.points[1]).toMatchObject({ lat: 41.21, lng: -111.89, ele: 1310 });
    expect(() => rwgpsTrack({ error: "private" })).toThrow(/public/);
  });
});
