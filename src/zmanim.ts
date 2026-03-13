import { HDate } from "@hebcal/core";
import {
  AstronomicalCalendar,
  ComplexZmanimCalendar,
  DateTime,
  GeoLocation,
} from "kosher-zmanim";
import tzLookup from "tz-lookup";

export interface Coords {
  lat: number;
  lng: number;
}

export interface HalachicTime {
  hour: number;
  minute: number;
  second: number;
  totalHours: number;
  isDaytime: boolean;
  dayHourMs: number;
  nightHourMs: number;
  currentHourNumber: number;
  currentHourProgress: number;
  currentHourStart: Date;
  currentHourEnd: Date;
  currentHourLabel: "Day" | "Night";
}

export interface ZmanEntry {
  id: string;
  label: string;
  shortLabel: string;
  time: Date;
}

export interface UpcomingZman extends ZmanEntry {
  isTomorrow: boolean;
  remainingMs: number;
}

export interface SpecialDayEvent {
  label: string;
  time: Date;
}

export interface CalculationDetails {
  methodLabel: string;
  methodSummary: string;
  dayDefinition: string;
  alosDefinition: string;
  tzeisDefinition: string;
  chatzosDefinition: string;
  candleLightingOffsetMinutes: number;
  elevationMode: string;
  timeZoneId: string;
  hebrewDateRule: string;
}

export interface ZmanDay {
  date: Date;
  method: ZmanMethod;
  methodLabel: string;
  methodSummary: string;
  sunrise: Date;
  sunset: Date;
  alos: Date;
  tzeis: Date;
  dayStart: Date;
  dayEnd: Date;
  dayStartLabel: string;
  dayEndLabel: string;
  sofZmanKriasShema: Date;
  sofZmanTefillah: Date;
  chatzos: Date;
  minchaGedola: Date;
  minchaKetana: Date;
  plagHamincha: Date;
  candleLighting: Date;
  dayLengthMs: number;
  nightLengthMs: number;
  dayHourMs: number;
  nightHourMs: number;
  zmanim: ZmanEntry[];
  timelineMarkers: ZmanEntry[];
  details: CalculationDetails;
}

export interface ZmanimSnapshot {
  day: ZmanDay;
  halachicTime: HalachicTime;
  nextZman: UpcomingZman | null;
  specialEvent: SpecialDayEvent | null;
  timelineProgress: number;
  gregorianDay: string;
  hebrewDate: string;
  timeZoneId: string;
}

export const TEMPLE_MOUNT: Coords = {
  lat: 31.776719274639515,
  lng: 35.234379734016926,
};

export const METHOD_OPTIONS = [
  {
    value: "gra",
    label: "Gra",
    uiLabel: "Gra (sunrise -> sunset)",
    description: "Shaos zmaniyos from neitz to shkiah",
  },
  {
    value: "mga",
    label: "Magen Avraham",
    uiLabel: "Magen Avraham (16.1 deg alos -> 16.1 deg tzeis)",
    description: "Degree-based alos/tzeis day definition",
  },
  {
    value: "fixed72",
    label: "72-minute",
    uiLabel: "72-minute offsets",
    description: "Fixed 72-minute alos/tzeis offsets",
  },
  {
    value: "fixed90",
    label: "90-minute",
    uiLabel: "90-minute offsets",
    description: "Fixed 90-minute alos/tzeis offsets",
  },
] as const;

export type ZmanMethod = (typeof METHOD_OPTIONS)[number]["value"];

type MethodCalculation = {
  methodLabel: string;
  methodSummary: string;
  dayDefinition: string;
  alosDefinition: string;
  tzeisDefinition: string;
  dayStartLabel: string;
  dayEndLabel: string;
  alos: Date;
  tzeis: Date;
  dayStart: Date;
  dayEnd: Date;
  shaahZmanisMs: number;
  sofZmanKriasShema: Date;
  sofZmanTefillah: Date;
  minchaGedola: Date;
  minchaKetana: Date;
  plagHamincha: Date;
};

const METHOD_STORAGE_KEY = "halachic-clock:zman-method";
const CANDLE_LIGHTING_OFFSET_MINUTES = 18;
const DEFAULT_ELEVATION_METERS = 0;
const MILLISECONDS_PER_MINUTE = 60_000;
const TIMELINE_IDS = new Set([
  "alos",
  "shema",
  "tefillah",
  "chatzos",
  "sunset",
  "tzeis",
]);

function isZmanMethod(value: string | null): value is ZmanMethod {
  return METHOD_OPTIONS.some((option) => option.value === value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getFallbackTimeZoneId(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getTimeZoneId(coords?: Coords): string {
  if (coords) {
    try {
      return tzLookup(coords.lat, coords.lng);
    } catch {
      // Fall back to the browser timezone if lookup fails for any reason.
    }
  }

  return getFallbackTimeZoneId();
}

function makeDayAnchor(date: Date, timeZoneId: string): DateTime {
  return DateTime.fromJSDate(date, { zone: timeZoneId }).set({
    hour: 12,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

function addDays(date: Date, days: number, timeZoneId: string): Date {
  return makeDayAnchor(date, timeZoneId).plus({ days }).toJSDate();
}

function toDate(dateTime: DateTime | null, label: string): Date {
  if (!dateTime || !dateTime.isValid) {
    throw new Error(`Could not compute ${label}`);
  }

  return dateTime.toJSDate();
}

function createCalendar(
  coords: Coords,
  date: Date,
  timeZoneId: string,
  locationName?: string
): ComplexZmanimCalendar {
  const geoLocation = new GeoLocation(
    locationName ?? null,
    coords.lat,
    coords.lng,
    DEFAULT_ELEVATION_METERS,
    timeZoneId
  );

  const calendar = new ComplexZmanimCalendar(geoLocation);
  calendar.setUseElevation(false);
  calendar.setCandleLightingOffset(CANDLE_LIGHTING_OFFSET_MINUTES);
  calendar.setDate(makeDayAnchor(date, timeZoneId));
  return calendar;
}

function calculateMethodTimes(
  calendar: ComplexZmanimCalendar,
  method: ZmanMethod
): MethodCalculation {
  if (method === "gra") {
    return {
      methodLabel: "Gra (sunrise -> sunset)",
      methodSummary: "Neitz to shkiah day with library sunrise/sunset zmanim.",
      dayDefinition: "Day is sunrise (neitz) to sunset (shkiah).",
      alosDefinition: "Alos Hashachar uses kosher-zmanim's 16.1 deg dawn.",
      tzeisDefinition: "Tzeis Hakochavim uses kosher-zmanim's default 8.5 deg nightfall.",
      dayStartLabel: "Sunrise",
      dayEndLabel: "Sunset",
      alos: toDate(calendar.getAlosHashachar(), "Gra alos"),
      tzeis: toDate(calendar.getTzais(), "Gra tzeis"),
      dayStart: toDate(calendar.getSunrise(), "Gra sunrise"),
      dayEnd: toDate(calendar.getSunset(), "Gra sunset"),
      shaahZmanisMs: calendar.getShaahZmanisGra(),
      sofZmanKriasShema: toDate(
        calendar.getSofZmanShmaGRA(),
        "Gra sof zman krias shema"
      ),
      sofZmanTefillah: toDate(
        calendar.getSofZmanTfilaGRA(),
        "Gra sof zman tefillah"
      ),
      minchaGedola: toDate(calendar.getMinchaGedola(), "Gra mincha gedola"),
      minchaKetana: toDate(calendar.getMinchaKetana(), "Gra mincha ketana"),
      plagHamincha: toDate(calendar.getPlagHamincha(), "Gra plag hamincha"),
    };
  }

  if (method === "mga") {
    return {
      methodLabel: "Magen Avraham (16.1 deg alos -> 16.1 deg tzeis)",
      methodSummary:
        "Degree-based dawn/nightfall day using kosher-zmanim's 16.1 deg pair.",
      dayDefinition: "Day is 16.1 deg alos to 16.1 deg tzeis.",
      alosDefinition: "Alos Hashachar is 16.1 deg below the eastern horizon.",
      tzeisDefinition: "Tzeis Hakochavim is 16.1 deg below the western horizon.",
      dayStartLabel: "Alos 16.1 deg",
      dayEndLabel: "Tzeis 16.1 deg",
      alos: toDate(calendar.getAlos16Point1Degrees(), "MGA alos"),
      tzeis: toDate(calendar.getTzais16Point1Degrees(), "MGA tzeis"),
      dayStart: toDate(calendar.getAlos16Point1Degrees(), "MGA day start"),
      dayEnd: toDate(calendar.getTzais16Point1Degrees(), "MGA day end"),
      shaahZmanisMs: calendar.getShaahZmanis16Point1Degrees(),
      sofZmanKriasShema: toDate(
        calendar.getSofZmanShmaMGA16Point1Degrees(),
        "MGA sof zman krias shema"
      ),
      sofZmanTefillah: toDate(
        calendar.getSofZmanTfilaMGA16Point1Degrees(),
        "MGA sof zman tefillah"
      ),
      minchaGedola: toDate(
        calendar.getMinchaGedola16Point1Degrees(),
        "MGA mincha gedola"
      ),
      minchaKetana: toDate(
        calendar.getMinchaKetana16Point1Degrees(),
        "MGA mincha ketana"
      ),
      plagHamincha: toDate(
        calendar.getPlagHamincha16Point1Degrees(),
        "MGA plag hamincha"
      ),
    };
  }

  if (method === "fixed72") {
    return {
      methodLabel: "72-minute offsets",
      methodSummary:
        "Fixed-offset alos/tzeis day using 72 minutes before sunrise and after sunset.",
      dayDefinition: "Day is fixed 72 minutes before sunrise to 72 minutes after sunset.",
      alosDefinition: "Alos Hashachar is sunrise minus 72 clock minutes.",
      tzeisDefinition: "Tzeis Hakochavim is sunset plus 72 clock minutes.",
      dayStartLabel: "Alos -72m",
      dayEndLabel: "Tzeis +72m",
      alos: toDate(calendar.getAlos72(), "72-minute alos"),
      tzeis: toDate(calendar.getTzais72(), "72-minute tzeis"),
      dayStart: toDate(calendar.getAlos72(), "72-minute day start"),
      dayEnd: toDate(calendar.getTzais72(), "72-minute day end"),
      shaahZmanisMs: calendar.getShaahZmanis72Minutes(),
      sofZmanKriasShema: toDate(
        calendar.getSofZmanShmaMGA72Minutes(),
        "72-minute sof zman krias shema"
      ),
      sofZmanTefillah: toDate(
        calendar.getSofZmanTfilaMGA72Minutes(),
        "72-minute sof zman tefillah"
      ),
      minchaGedola: toDate(
        calendar.getMinchaGedola72Minutes(),
        "72-minute mincha gedola"
      ),
      minchaKetana: toDate(
        calendar.getMinchaKetana72Minutes(),
        "72-minute mincha ketana"
      ),
      plagHamincha: toDate(
        calendar.getPlagHamincha72Minutes(),
        "72-minute plag hamincha"
      ),
    };
  }

  const alos90 = calendar.getAlos90();
  const tzeis90 = calendar.getTzais90();

  return {
    methodLabel: "90-minute offsets",
    methodSummary:
      "Fixed-offset alos/tzeis day using 90 minutes before sunrise and after sunset.",
    dayDefinition: "Day is fixed 90 minutes before sunrise to 90 minutes after sunset.",
    alosDefinition: "Alos Hashachar is sunrise minus 90 clock minutes.",
    tzeisDefinition: "Tzeis Hakochavim is sunset plus 90 clock minutes.",
    dayStartLabel: "Alos -90m",
    dayEndLabel: "Tzeis +90m",
    alos: toDate(alos90, "90-minute alos"),
    tzeis: toDate(tzeis90, "90-minute tzeis"),
    dayStart: toDate(alos90, "90-minute day start"),
    dayEnd: toDate(tzeis90, "90-minute day end"),
    shaahZmanisMs: calendar.getShaahZmanis90Minutes(),
    sofZmanKriasShema: toDate(
      calendar.getSofZmanShmaMGA90Minutes(),
      "90-minute sof zman krias shema"
    ),
    sofZmanTefillah: toDate(
      calendar.getSofZmanTfilaMGA90Minutes(),
      "90-minute sof zman tefillah"
    ),
    minchaGedola: toDate(
      calendar.getMinchaGedola(alos90, tzeis90, false),
      "90-minute mincha gedola"
    ),
    minchaKetana: toDate(
      calendar.getMinchaKetana(alos90, tzeis90, false),
      "90-minute mincha ketana"
    ),
    plagHamincha: toDate(
      calendar.getPlagHamincha90Minutes(),
      "90-minute plag hamincha"
    ),
  };
}

function buildZmanEntries(day: ZmanDay): ZmanEntry[] {
  return [
    {
      id: "alos",
      label: "Alos Hashachar",
      shortLabel: "Alos",
      time: day.alos,
    },
    {
      id: "sunrise",
      label: "Sunrise (Neitz)",
      shortLabel: "Sunrise",
      time: day.sunrise,
    },
    {
      id: "shema",
      label: "Sof Zman Krias Shema",
      shortLabel: "Shema",
      time: day.sofZmanKriasShema,
    },
    {
      id: "tefillah",
      label: "Sof Zman Tefillah",
      shortLabel: "Tefillah",
      time: day.sofZmanTefillah,
    },
    {
      id: "chatzos",
      label: "Chatzos",
      shortLabel: "Chatzos",
      time: day.chatzos,
    },
    {
      id: "mincha-gedola",
      label: "Mincha Gedola",
      shortLabel: "Mincha G.",
      time: day.minchaGedola,
    },
    {
      id: "mincha-ketana",
      label: "Mincha Ketana",
      shortLabel: "Mincha K.",
      time: day.minchaKetana,
    },
    {
      id: "plag",
      label: "Plag Hamincha",
      shortLabel: "Plag",
      time: day.plagHamincha,
    },
    {
      id: "sunset",
      label: "Sunset (Shkiah)",
      shortLabel: "Sunset",
      time: day.sunset,
    },
    {
      id: "tzeis",
      label: "Tzeis Hakochavim",
      shortLabel: "Tzeis",
      time: day.tzeis,
    },
  ];
}

function buildCalculationDetails(
  methodCalculation: MethodCalculation,
  timeZoneId: string
): CalculationDetails {
  return {
    methodLabel: methodCalculation.methodLabel,
    methodSummary: methodCalculation.methodSummary,
    dayDefinition: methodCalculation.dayDefinition,
    alosDefinition: methodCalculation.alosDefinition,
    tzeisDefinition: methodCalculation.tzeisDefinition,
    chatzosDefinition:
      "Chatzos is astronomical midday (solar transit) from kosher-zmanim.",
    candleLightingOffsetMinutes: CANDLE_LIGHTING_OFFSET_MINUTES,
    elevationMode: "Sea-level / standard astronomical calculations; elevation disabled.",
    timeZoneId,
    hebrewDateRule:
      "Hebrew date uses @hebcal/core and rolls forward after sunset (shkiah).",
  };
}

export function loadZmanimEngine(): Promise<void> {
  return Promise.resolve();
}

export function getDisplayHour(hour: number): number {
  return hour + 1;
}

export function readStoredMethod(): ZmanMethod {
  if (typeof window === "undefined") return "mga";

  try {
    const stored = window.localStorage.getItem(METHOD_STORAGE_KEY);
    return isZmanMethod(stored) ? stored : "mga";
  } catch {
    return "mga";
  }
}

export function persistMethod(method: ZmanMethod): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(METHOD_STORAGE_KEY, method);
  } catch {
    // Ignore storage failures and keep the current in-memory method.
  }
}

export function formatWeekday(date: Date, timeZoneId = getFallbackTimeZoneId()): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: timeZoneId,
  }).format(date);
}

export function formatHebrewDate(
  date: Date,
  sunset: Date | null,
  timeZoneId = getFallbackTimeZoneId()
): string {
  const dateTime = DateTime.fromJSDate(date, { zone: timeZoneId });
  const useNextDay =
    sunset !== null && dateTime.toMillis() >= DateTime.fromJSDate(sunset, { zone: timeZoneId }).toMillis();
  const hebrewDate = new HDate(
    (useNextDay ? dateTime.plus({ days: 1 }) : dateTime).toJSDate()
  );

  return hebrewDate.toString();
}

export function buildZmanDay(
  date: Date,
  coords: Coords,
  method: ZmanMethod,
  locationName?: string,
  timeZoneId = getTimeZoneId(coords)
): ZmanDay {
  const calendar = createCalendar(coords, date, timeZoneId, locationName);
  const tomorrowCalendar = createCalendar(
    coords,
    addDays(date, 1, timeZoneId),
    timeZoneId,
    locationName
  );

  const methodCalculation = calculateMethodTimes(calendar, method);
  const tomorrowMethod = calculateMethodTimes(tomorrowCalendar, method);
  const sunrise = toDate(calendar.getSunrise(), "sunrise");
  const sunset = toDate(calendar.getSunset(), "sunset");
  const chatzos = toDate(calendar.getChatzos(), "chatzos");
  const candleLighting = toDate(calendar.getCandleLighting(), "candle lighting");
  const dayLengthMs =
    methodCalculation.dayEnd.getTime() - methodCalculation.dayStart.getTime();
  const nightLengthMs =
    tomorrowMethod.dayStart.getTime() - methodCalculation.dayEnd.getTime();

  const details = buildCalculationDetails(methodCalculation, timeZoneId);
  const day: ZmanDay = {
    date: makeDayAnchor(date, timeZoneId).toJSDate(),
    method,
    methodLabel: methodCalculation.methodLabel,
    methodSummary: methodCalculation.methodSummary,
    sunrise,
    sunset,
    alos: methodCalculation.alos,
    tzeis: methodCalculation.tzeis,
    dayStart: methodCalculation.dayStart,
    dayEnd: methodCalculation.dayEnd,
    dayStartLabel: methodCalculation.dayStartLabel,
    dayEndLabel: methodCalculation.dayEndLabel,
    sofZmanKriasShema: methodCalculation.sofZmanKriasShema,
    sofZmanTefillah: methodCalculation.sofZmanTefillah,
    chatzos,
    minchaGedola: methodCalculation.minchaGedola,
    minchaKetana: methodCalculation.minchaKetana,
    plagHamincha: methodCalculation.plagHamincha,
    candleLighting,
    dayLengthMs,
    nightLengthMs,
    dayHourMs: methodCalculation.shaahZmanisMs,
    nightHourMs: nightLengthMs / 12,
    zmanim: [],
    timelineMarkers: [],
    details,
  };

  day.zmanim = buildZmanEntries(day);
  day.timelineMarkers = day.zmanim.filter((zman) => TIMELINE_IDS.has(zman.id));
  return day;
}

function computeHalachicTime(
  now: Date,
  yesterday: ZmanDay,
  today: ZmanDay,
  tomorrow: ZmanDay
): HalachicTime {
  const nowMs = now.getTime();

  let isDaytime = true;
  let periodStart = today.dayStart;
  let periodEnd = today.dayEnd;
  let periodOffset = 0;
  let dayHourMs = today.dayHourMs;
  let nightHourMs = today.nightHourMs;

  if (nowMs >= today.dayStart.getTime() && nowMs < today.dayEnd.getTime()) {
    periodStart = today.dayStart;
    periodEnd = today.dayEnd;
  } else if (nowMs >= today.dayEnd.getTime()) {
    isDaytime = false;
    periodStart = today.dayEnd;
    periodEnd = tomorrow.dayStart;
    periodOffset = 12;
    nightHourMs = (periodEnd.getTime() - periodStart.getTime()) / 12;
  } else {
    isDaytime = false;
    periodStart = yesterday.dayEnd;
    periodEnd = today.dayStart;
    periodOffset = 12;
    dayHourMs = yesterday.dayHourMs;
    nightHourMs = (periodEnd.getTime() - periodStart.getTime()) / 12;
  }

  const periodMs = periodEnd.getTime() - periodStart.getTime();
  const elapsedMs = clamp(nowMs - periodStart.getTime(), 0, periodMs);
  const fractionalHours = (elapsedMs / periodMs) * 12;
  const totalHours = periodOffset + fractionalHours;
  const wholeHours = Math.floor(totalHours);
  const hour = ((wholeHours % 24) + 24) % 24;
  const remainderMinutes = (totalHours - wholeHours) * 60;
  const minute = Math.floor(remainderMinutes);
  const second = Math.floor((remainderMinutes - minute) * 60);

  const activeHourMs = isDaytime ? dayHourMs : nightHourMs;
  const currentHourIndex = clamp(Math.floor(elapsedMs / activeHourMs), 0, 11);
  const currentHourStart = new Date(
    periodStart.getTime() + currentHourIndex * activeHourMs
  );
  const currentHourEnd = new Date(currentHourStart.getTime() + activeHourMs);

  return {
    hour,
    minute,
    second,
    totalHours: ((totalHours % 24) + 24) % 24,
    isDaytime,
    dayHourMs,
    nightHourMs,
    currentHourNumber: currentHourIndex + 1,
    currentHourProgress: clamp(
      (now.getTime() - currentHourStart.getTime()) / activeHourMs,
      0,
      1
    ),
    currentHourStart,
    currentHourEnd,
    currentHourLabel: isDaytime ? "Day" : "Night",
  };
}

function getNextZman(now: Date, today: ZmanDay, tomorrow: ZmanDay): UpcomingZman | null {
  const candidates = [
    ...today.zmanim.map((zman) => ({
      ...zman,
      isTomorrow: false,
    })),
    ...tomorrow.zmanim.map((zman) => ({
      ...zman,
      isTomorrow: true,
    })),
  ];

  const next = candidates.find((candidate) => candidate.time.getTime() > now.getTime());
  if (!next) return null;

  return {
    ...next,
    remainingMs: next.time.getTime() - now.getTime(),
  };
}

function getSpecialDayEvent(
  now: Date,
  today: ZmanDay,
  tomorrow: ZmanDay,
  timeZoneId: string
): SpecialDayEvent | null {
  const weekday = DateTime.fromJSDate(now, { zone: timeZoneId }).weekday;

  if (weekday === 5 && now.getTime() < today.sunset.getTime()) {
    return {
      label: "Candle lighting",
      time: today.candleLighting,
    };
  }

  if (weekday === 5 && now.getTime() >= today.sunset.getTime()) {
    return {
      label: "Havdalah",
      time: tomorrow.tzeis,
    };
  }

  if (weekday === 6 && now.getTime() < today.tzeis.getTime()) {
    return {
      label: "Havdalah",
      time: today.tzeis,
    };
  }

  return null;
}

export function calculateZmanimSnapshot(
  now: Date,
  coords: Coords,
  method: ZmanMethod,
  locationName?: string
): ZmanimSnapshot {
  const timeZoneId = getTimeZoneId(coords);
  const yesterday = buildZmanDay(
    addDays(now, -1, timeZoneId),
    coords,
    method,
    locationName,
    timeZoneId
  );
  const today = buildZmanDay(now, coords, method, locationName, timeZoneId);
  const tomorrow = buildZmanDay(
    addDays(now, 1, timeZoneId),
    coords,
    method,
    locationName,
    timeZoneId
  );

  const timelineStartMs = today.alos.getTime();
  const timelineEndMs = today.tzeis.getTime();

  return {
    day: today,
    halachicTime: computeHalachicTime(now, yesterday, today, tomorrow),
    nextZman: getNextZman(now, today, tomorrow),
    specialEvent: getSpecialDayEvent(now, today, tomorrow, timeZoneId),
    timelineProgress: clamp(
      (now.getTime() - timelineStartMs) / (timelineEndMs - timelineStartMs),
      0,
      1
    ),
    gregorianDay: formatWeekday(now, timeZoneId),
    hebrewDate: formatHebrewDate(now, today.sunset, timeZoneId),
    timeZoneId,
  };
}
