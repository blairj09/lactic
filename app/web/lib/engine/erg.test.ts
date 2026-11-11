import { describe, expect, it } from "vitest";
import { parseErgMrc, workoutFromFile } from "./erg";
import { ramp, steady } from "./workout";

const mrc = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Sweet spot 3x10
FILE NAME = ss.mrc
MINUTES PERCENT
[END COURSE HEADER]
[COURSE DATA]
0.00	50
10.00	75
10.00	90
20.00	90
20.00	55
25.00	55
[END COURSE DATA]
`;

const erg = `[COURSE HEADER]
FTP = 200
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0 100
5 100
5 300
6 300
[END COURSE DATA]`;

describe("parseErgMrc", () => {
  it("reads percent rows as ramps and steps", () => {
    expect(parseErgMrc(mrc, "ss.mrc", 250)).toEqual({
      name: "Sweet spot 3x10",
      segments: [ramp(600, 0.5, 0.75), steady(600, 0.9), steady(300, 0.55)],
    });
  });

  it("scales watts by the file's FTP, else the rider's", () => {
    expect(parseErgMrc(erg, "vo2.erg", 250).segments).toEqual([steady(300, 0.5), steady(60, 1.5)]);
    expect(parseErgMrc(erg.replace("FTP = 200\n", ""), "vo2.erg", 250).segments).toEqual([steady(300, 0.4), steady(60, 1.2)]);
    expect(parseErgMrc(erg, "vo2.erg", 250).name).toBe("vo2");
  });

  it("tells the formats apart by content", () => {
    expect(workoutFromFile(mrc, "x.txt", 250).name).toBe("Sweet spot 3x10");
    expect(workoutFromFile('<workout_file><name>Z</name><workout><SteadyState Duration="60" Power="0.6"/></workout></workout_file>', "z.zwo", 250).name).toBe("Z");
  });
});
