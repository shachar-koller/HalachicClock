import { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface SunTimes {
  sunrise: Date;
  sunset: Date;
}

interface HalachicTime {
  hour: number;
  minute: number;
  second: number;
  totalHours: number;
  isDaytime: boolean;
  dayHourMs: number;
  nightHourMs: number;
}

interface Coords {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const TEMPLE_MOUNT: Coords = { lat: 31.776719274639515, lng: 35.234379734016926 };

declare global {
  interface Window {
    SunCalc: {
      getTimes: (
        date: Date,
        lat: number,
        lng: number
      ) => { sunrise: Date; sunset: Date };
    };
  }
}

function loadSunCalc(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.SunCalc) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src =
      "https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load SunCalc"));
    document.head.appendChild(s);
  });
}

function getSunTimes(date: Date, coords: Coords): SunTimes {
  const t = window.SunCalc.getTimes(date, coords.lat, coords.lng);
  return { sunrise: t.sunrise, sunset: t.sunset };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function fmtCivil(d: Date): string {
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function computeHalachicTime(now: Date, coords: Coords): HalachicTime | null {
  if (!window.SunCalc) return null;

  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todaySun = getSunTimes(today, coords);
  const yesterdaySun = getSunTimes(yesterday, coords);
  const tomorrowSun = getSunTimes(tomorrow, coords);

  const nowMs = now.getTime();

  let isDaytime: boolean;
  let elapsed: number;
  let periodMs: number;
  let periodOffset: number; // 0 for day, 12 for night
  let dayHourMs: number;
  let nightHourMs: number;

  // Calculate day hour length (today)
  const todayDayMs = todaySun.sunset.getTime() - todaySun.sunrise.getTime();
  dayHourMs = todayDayMs / 12;

  if (nowMs >= todaySun.sunrise.getTime() && nowMs < todaySun.sunset.getTime()) {
    // Daytime: between today's sunrise and sunset
    isDaytime = true;
    elapsed = nowMs - todaySun.sunrise.getTime();
    periodMs = todayDayMs;
    periodOffset = 0;
    // Night = today sunset -> tomorrow sunrise
    const nightMs =
      tomorrowSun.sunrise.getTime() - todaySun.sunset.getTime();
    nightHourMs = nightMs / 12;
  } else if (nowMs >= todaySun.sunset.getTime()) {
    // Nighttime after sunset (before midnight conceptually, but could be after)
    isDaytime = false;
    const nightStart = todaySun.sunset.getTime();
    const nightEnd = tomorrowSun.sunrise.getTime();
    elapsed = nowMs - nightStart;
    periodMs = nightEnd - nightStart;
    periodOffset = 12;
    nightHourMs = periodMs / 12;
  } else {
    // Nighttime before sunrise (after midnight)
    isDaytime = false;
    const nightStart = yesterdaySun.sunset.getTime();
    const nightEnd = todaySun.sunrise.getTime();
    elapsed = nowMs - nightStart;
    periodMs = nightEnd - nightStart;
    periodOffset = 12;
    nightHourMs = periodMs / 12;
    // Use yesterday's day duration for dayHourMs context
    const yesterdayDayMs =
      yesterdaySun.sunset.getTime() - yesterdaySun.sunrise.getTime();
    dayHourMs = yesterdayDayMs / 12;
  }

  const fractionalHoursInPeriod = (elapsed / periodMs) * 12;
  const totalHours = periodOffset + fractionalHoursInPeriod;

  const hour = Math.floor(totalHours) % 24;
  const remainderMinutes = (totalHours - Math.floor(totalHours)) * 60;
  const minute = Math.floor(remainderMinutes);
  const second = Math.floor((remainderMinutes - minute) * 60);

  return {
    hour,
    minute,
    second,
    totalHours: totalHours % 24,
    isDaytime,
    dayHourMs,
    nightHourMs,
  };
}

/* ------------------------------------------------------------------ */
/*  Canvas drawing                                                     */
/* ------------------------------------------------------------------ */
function drawClock(
  ctx: CanvasRenderingContext2D,
  size: number,
  hTime: HalachicTime | null,
  isDaytime: boolean
) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 16;
  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // Colours
  const bgOuter = isDaytime ? "#f0e6d3" : "#1a1a2e";
  const bgInner = isDaytime ? "#faf6ee" : "#16213e";
  const faceRing = isDaytime ? "#c9a96e" : "#4a4e7a";
  const tickColor = isDaytime ? "#7a6840" : "#8888bb";
  const majorTickColor = isDaytime ? "#4a3820" : "#ccccee";
  const numeralColor = isDaytime ? "#3e2c10" : "#e0d8c8";
  const handColor = isDaytime ? "#b8860b" : "#ffd700";
  const dayArc = isDaytime ? "rgba(255,200,50,0.18)" : "rgba(255,200,50,0.08)";
  const nightArc = isDaytime
    ? "rgba(40,40,100,0.08)"
    : "rgba(80,80,180,0.18)";
  const centerDot = isDaytime ? "#8B6914" : "#ffd700";

  // Background gradient
  const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.15);
  grad.addColorStop(0, bgInner);
  grad.addColorStop(1, bgOuter);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
  ctx.fill();

  // Outer ring
  ctx.strokeStyle = faceRing;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.stroke();

  // Day arc (0→12 = top→bottom, clockwise right side)
  // In our mapping: hour 0 at top = -π/2, hour 12 at bottom = π/2
  const arcR = r - 14;
  ctx.fillStyle = dayArc;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, arcR, -Math.PI / 2, Math.PI / 2, false);
  ctx.closePath();
  ctx.fill();

  // Night arc (12→24 = bottom→top, clockwise left side)
  ctx.fillStyle = nightArc;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, arcR, Math.PI / 2, -Math.PI / 2, false);
  ctx.closePath();
  ctx.fill();

  // Subtle sun / moon icons
  const iconSize = 11;
  // Sun icon at hour 6 position (right side, 3 o'clock)
  const sunAngle = (6 / 24) * Math.PI * 2 - Math.PI / 2;
  const sunX = cx + Math.cos(sunAngle) * (r - 36);
  const sunY = cy + Math.sin(sunAngle) * (r - 36);
  ctx.fillStyle = isDaytime
    ? "rgba(255,180,0,0.45)"
    : "rgba(255,180,0,0.2)";
  ctx.beginPath();
  ctx.arc(sunX, sunY, iconSize, 0, Math.PI * 2);
  ctx.fill();
  // Sun rays
  ctx.strokeStyle = isDaytime
    ? "rgba(255,180,0,0.35)"
    : "rgba(255,180,0,0.15)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(
      sunX + Math.cos(a) * (iconSize + 2),
      sunY + Math.sin(a) * (iconSize + 2)
    );
    ctx.lineTo(
      sunX + Math.cos(a) * (iconSize + 6),
      sunY + Math.sin(a) * (iconSize + 6)
    );
    ctx.stroke();
  }

  // Moon icon at hour 18 position (left side, 9 o'clock)
  const moonAngle = (18 / 24) * Math.PI * 2 - Math.PI / 2;
  const moonX = cx + Math.cos(moonAngle) * (r - 36);
  const moonY = cy + Math.sin(moonAngle) * (r - 36);
  ctx.fillStyle = isDaytime
    ? "rgba(150,150,200,0.2)"
    : "rgba(200,200,240,0.35)";
  ctx.beginPath();
  ctx.arc(moonX, moonY, iconSize, 0, Math.PI * 2);
  ctx.fill();
  // Moon crescent (cut-out circle)
  ctx.fillStyle = isDaytime ? bgInner : bgInner;
  ctx.globalCompositeOperation = "source-atop";
  ctx.beginPath();
  ctx.arc(moonX + 5, moonY - 3, iconSize - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  // Redraw moon cleanly
  ctx.fillStyle = isDaytime
    ? "rgba(150,150,200,0.2)"
    : "rgba(200,200,240,0.35)";
  ctx.beginPath();
  ctx.arc(moonX, moonY, iconSize, 0, Math.PI * 2);
  ctx.fill();
  const cutStyle = isDaytime ? bgInner : bgInner;
  ctx.fillStyle = cutStyle;
  ctx.beginPath();
  ctx.arc(moonX + 5, moonY - 3, iconSize - 2, 0, Math.PI * 2);
  ctx.fill();

  // Tick marks
  for (let h = 0; h < 24; h++) {
    const angle = (h / 24) * Math.PI * 2 - Math.PI / 2;
    const isMajor = h % 6 === 0;
    const innerR = isMajor ? r - 18 : r - 10;
    const outerR = r - 2;
    ctx.strokeStyle = isMajor ? majorTickColor : tickColor;
    ctx.lineWidth = isMajor ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.stroke();
  }

  // Numerals at 0, 6, 12, 18
  const numerals = [
    { h: 0, label: "0" },
    { h: 6, label: "6" },
    { h: 12, label: "12" },
    { h: 18, label: "18" },
  ];
  ctx.fillStyle = numeralColor;
  ctx.font = `bold ${Math.round(size * 0.058)}px 'Georgia', serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { h, label } of numerals) {
    const angle = (h / 24) * Math.PI * 2 - Math.PI / 2;
    const nr = r - 30;
    ctx.fillText(
      label,
      cx + Math.cos(angle) * nr,
      cy + Math.sin(angle) * nr
    );
  }

  // Sub-labels
  ctx.font = `${Math.round(size * 0.032)}px 'Georgia', serif`;
  ctx.fillStyle = isDaytime
    ? "rgba(100,80,40,0.45)"
    : "rgba(180,180,220,0.4)";
  // "DAY" near hour 3 (top-right area)
  const dayLabelAngle = (3 / 24) * Math.PI * 2 - Math.PI / 2;
  ctx.fillText(
    "DAY",
    cx + Math.cos(dayLabelAngle) * (r * 0.52),
    cy + Math.sin(dayLabelAngle) * (r * 0.52)
  );
  // "NIGHT" near hour 21 (top-left area)
  const nightLabelAngle = (21 / 24) * Math.PI * 2 - Math.PI / 2;
  ctx.fillText(
    "NIGHT",
    cx + Math.cos(nightLabelAngle) * (r * 0.52),
    cy + Math.sin(nightLabelAngle) * (r * 0.52)
  );

  // Minor minute ticks (every hour has 4 sub-divisions)
  for (let i = 0; i < 24 * 4; i++) {
    if (i % 4 === 0) continue; // skip hour marks
    const angle = (i / 96) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = isDaytime
      ? "rgba(120,100,60,0.25)"
      : "rgba(120,120,180,0.2)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(angle) * (r - 5),
      cy + Math.sin(angle) * (r - 5)
    );
    ctx.lineTo(
      cx + Math.cos(angle) * (r - 2),
      cy + Math.sin(angle) * (r - 2)
    );
    ctx.stroke();
  }

  // Clock hand
  if (hTime) {
    const handAngle =
      (hTime.totalHours / 24) * Math.PI * 2 - Math.PI / 2;
    const handLen = r - 40;

    // Hand shadow
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    // Hand body
    ctx.strokeStyle = handColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(handAngle) * handLen,
      cy + Math.sin(handAngle) * handLen
    );
    ctx.stroke();

    // Arrow tip
    const tipX = cx + Math.cos(handAngle) * handLen;
    const tipY = cy + Math.sin(handAngle) * handLen;
    const arrowSize = 8;
    const leftA = handAngle + Math.PI - 0.3;
    const rightA = handAngle + Math.PI + 0.3;
    ctx.fillStyle = handColor;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX + Math.cos(leftA) * arrowSize,
      tipY + Math.sin(leftA) * arrowSize
    );
    ctx.lineTo(
      tipX + Math.cos(rightA) * arrowSize,
      tipY + Math.sin(rightA) * arrowSize
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Center dot
    ctx.fillStyle = centerDot;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isDaytime ? bgInner : "#0f1528";
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [coords, setCoords] = useState<Coords>(TEMPLE_MOUNT);
  const [sunCalcLoaded, setSunCalcLoaded] = useState(false);
  const [hTime, setHTime] = useState<HalachicTime | null>(null);
  const [sunrise, setSunrise] = useState<Date | null>(null);
  const [sunset, setSunset] = useState<Date | null>(null);
  const [civilTime, setCivilTime] = useState(new Date());
  const [locationName, setLocationName] = useState("Temple Mount (default)");
  const [canvasSize, setCanvasSize] = useState(340);

  // Responsive canvas size
  useEffect(() => {
    function updateSize() {
      const w = window.innerWidth;
      if (w < 400) setCanvasSize(280);
      else if (w < 600) setCanvasSize(320);
      else setCanvasSize(360);
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Load SunCalc
  useEffect(() => {
    loadSunCalc()
      .then(() => setSunCalcLoaded(true))
      .catch(() => console.error("Could not load SunCalc"));
  }, []);

  // Geolocation
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationName(
          `${pos.coords.latitude.toFixed(3)}°, ${pos.coords.longitude.toFixed(3)}°`
        );
      },
      () => {
        // denied – keep NYC
      }
    );
  }, []);

  // Compute halachic time every 200ms
  const tick = useCallback(() => {
    if (!sunCalcLoaded) return;
    const now = new Date();
    setCivilTime(now);

    const todaySun = getSunTimes(now, coords);
    setSunrise(todaySun.sunrise);
    setSunset(todaySun.sunset);

    const ht = computeHalachicTime(now, coords);
    setHTime(ht);
  }, [sunCalcLoaded, coords]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [tick]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawClock(ctx, canvasSize, hTime, hTime?.isDaytime ?? true);
  }, [hTime, canvasSize]);

  const isDaytime = hTime?.isDaytime ?? true;

  // Format halachic digital time
  const halachicDigital = hTime
    ? `${pad(hTime.hour)}:${pad(hTime.minute)}:${pad(hTime.second)}`
    : "--:--:--";

  // Format halachic hour length
  const dayHourMin = hTime
    ? (hTime.dayHourMs / 60000).toFixed(1)
    : "--";
  const nightHourMin = hTime
    ? (hTime.nightHourMs / 60000).toFixed(1)
    : "--";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: "'Georgia', 'Times New Roman', serif",
        transition: "background 0.8s ease, color 0.8s ease",
        background: isDaytime
          ? "linear-gradient(180deg, #f5ead0 0%, #e8d5a8 50%, #d4b976 100%)"
          : "linear-gradient(180deg, #0d1117 0%, #161b22 50%, #1a1f36 100%)",
        color: isDaytime ? "#3e2c10" : "#d4cfc4",
      }}
    >
      {/* Title */}
      <h1
        style={{
          fontSize: "clamp(1.3rem, 4vw, 1.8rem)",
          fontWeight: 700,
          marginBottom: 4,
          letterSpacing: "0.03em",
          textAlign: "center",
          color: isDaytime ? "#4a3010" : "#e8dcc8",
        }}
      >
        שעות זמניות
      </h1>
      <p
        style={{
          fontSize: "clamp(0.85rem, 2.5vw, 1.05rem)",
          marginBottom: 20,
          opacity: 0.7,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        Halachic Clock
      </p>

      {/* Canvas */}
      <div
        style={{
          borderRadius: "50%",
          boxShadow: isDaytime
            ? "0 8px 32px rgba(120,90,30,0.25), inset 0 0 20px rgba(255,255,255,0.15)"
            : "0 8px 32px rgba(0,0,0,0.5), inset 0 0 20px rgba(100,100,180,0.08)",
          marginBottom: 24,
          lineHeight: 0,
        }}
      >
        <canvas ref={canvasRef} />
      </div>

      {/* Digital readout */}
      <div
        style={{
          background: isDaytime
            ? "rgba(255,255,255,0.35)"
            : "rgba(20,24,40,0.6)",
          backdropFilter: "blur(8px)",
          borderRadius: 16,
          padding: "20px 28px",
          maxWidth: 420,
          width: "100%",
          boxShadow: isDaytime
            ? "0 2px 12px rgba(120,90,30,0.12)"
            : "0 2px 12px rgba(0,0,0,0.3)",
          border: isDaytime
            ? "1px solid rgba(180,150,80,0.25)"
            : "1px solid rgba(100,100,180,0.15)",
        }}
      >
        {/* Halachic time */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div
            style={{
              fontSize: "clamp(0.6rem, 2vw, 0.72rem)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              opacity: 0.55,
              marginBottom: 4,
            }}
          >
            Halachic Time
          </div>
          <div
            style={{
              fontSize: "clamp(2rem, 7vw, 2.8rem)",
              fontWeight: 700,
              fontFamily: "'Courier New', monospace",
              letterSpacing: "0.06em",
              color: isDaytime ? "#6b4e1a" : "#ffd700",
            }}
          >
            {halachicDigital}
          </div>
          <div
            style={{
              fontSize: "clamp(0.65rem, 1.8vw, 0.78rem)",
              opacity: 0.5,
              marginTop: 2,
            }}
          >
            {isDaytime ? "☀ Daytime" : "☽ Nighttime"} · Hour{" "}
            {hTime ? hTime.hour : "--"} of 24
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: isDaytime
              ? "rgba(120,90,30,0.15)"
              : "rgba(150,150,220,0.12)",
            margin: "0 0 14px",
          }}
        />

        {/* Info rows */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px 16px",
            fontSize: "clamp(0.72rem, 2vw, 0.82rem)",
          }}
        >
          <InfoRow
            label="Sunrise"
            value={sunrise ? fmtCivil(sunrise) : "--"}
            icon="🌅"
            isDaytime={isDaytime}
          />
          <InfoRow
            label="Sunset"
            value={sunset ? fmtCivil(sunset) : "--"}
            icon="🌇"
            isDaytime={isDaytime}
          />
          <InfoRow
            label="Day Hour"
            value={`${dayHourMin} min`}
            icon="☀"
            isDaytime={isDaytime}
          />
          <InfoRow
            label="Night Hour"
            value={`${nightHourMin} min`}
            icon="☽"
            isDaytime={isDaytime}
          />
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: isDaytime
              ? "rgba(120,90,30,0.15)"
              : "rgba(150,150,220,0.12)",
            margin: "14px 0",
          }}
        />

        {/* Civil time & location */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "clamp(0.7rem, 2vw, 0.82rem)",
          }}
        >
          <div>
            <span style={{ opacity: 0.5 }}>Civil: </span>
            <span style={{ fontFamily: "'Courier New', monospace" }}>
              {fmtCivil(civilTime)}
            </span>
          </div>
          <div style={{ opacity: 0.45, fontSize: "0.75em" }}>
            📍 {locationName}
          </div>
        </div>
      </div>

      {/* Explanation */}
      <p
        style={{
          marginTop: 20,
          maxWidth: 440,
          textAlign: "center",
          fontSize: "clamp(0.68rem, 1.8vw, 0.78rem)",
          lineHeight: 1.6,
          opacity: 0.55,
        }}
      >
        <strong>Sha'os Zmaniyot</strong> (שעות זמניות) are "proportional hours"
        — the day from sunrise to sunset is divided into 12 equal parts, as is
        the night from sunset to the next sunrise, so each halachic hour's
        real-world length changes daily with the seasons.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small sub-component                                                */
/* ------------------------------------------------------------------ */
function InfoRow({
  label,
  value,
  icon,
  isDaytime,
}: {
  label: string;
  value: string;
  icon: string;
  isDaytime: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.85em",
          opacity: 0.5,
          marginBottom: 1,
        }}
      >
        {icon} {label}
      </div>
      <div
        style={{
          fontFamily: "'Courier New', monospace",
          fontWeight: 600,
          color: isDaytime ? "#5a3e12" : "#ccc8b8",
        }}
      >
        {value}
      </div>
    </div>
  );
}
