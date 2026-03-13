import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  METHOD_OPTIONS,
  TEMPLE_MOUNT,
  calculateZmanimSnapshot,
  formatHebrewDate,
  formatWeekday,
  getDisplayHour,
  loadZmanimEngine,
  persistMethod,
  readStoredMethod,
  type Coords,
  type HalachicTime,
  type ZmanEntry,
  type ZmanMethod,
  type ZmanimSnapshot,
} from "./zmanim";

const CLOCK_TICK_BUFFER_MS = 25;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function fmtClockTime(date: Date, timeZoneId?: string): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: timeZoneId,
  });
}

function fmtZmanTime(date: Date, timeZoneId?: string): string {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timeZoneId,
  });
}

function formatCoords(coords: Coords): string {
  return `${coords.lat.toFixed(3)}°, ${coords.lng.toFixed(3)}°`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${pad(minutes)}m`;
}

function isWidgetMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("widget") === "1";
}

async function reverseGeocode(
  coords: Coords,
  signal: AbortSignal
): Promise<string | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: coords.lat.toString(),
    lon: coords.lng.toString(),
    zoom: "10",
    addressdetails: "1",
  });

  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
    {
      headers: {
        Accept: "application/json",
      },
      signal,
    }
  );

  if (!response.ok) {
    throw new Error(`Reverse geocoding failed with ${response.status}`);
  }

  const data = (await response.json()) as {
    address?: Record<string, string | undefined>;
  };
  const address = data.address;
  if (!address) return null;

  const city =
    address.city ??
    address.town ??
    address.village ??
    address.hamlet ??
    address.suburb ??
    address.county;
  const region = address.state ?? address.region;

  if (city && region) return `${city}, ${region}`;
  return city ?? region ?? null;
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
  const centerDot = isDaytime ? "#8b6914" : "#ffd700";

  const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.15);
  grad.addColorStop(0, bgInner);
  grad.addColorStop(1, bgOuter);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = faceRing;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.stroke();

  const arcR = r - 14;
  ctx.fillStyle = dayArc;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, arcR, -Math.PI / 2, Math.PI / 2, false);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = nightArc;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, arcR, Math.PI / 2, -Math.PI / 2, false);
  ctx.closePath();
  ctx.fill();

  const iconSize = 11;
  const sunAngle = (6 / 24) * Math.PI * 2 - Math.PI / 2;
  const sunX = cx + Math.cos(sunAngle) * (r - 36);
  const sunY = cy + Math.sin(sunAngle) * (r - 36);
  ctx.fillStyle = isDaytime
    ? "rgba(255,180,0,0.45)"
    : "rgba(255,180,0,0.2)";
  ctx.beginPath();
  ctx.arc(sunX, sunY, iconSize, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = isDaytime
    ? "rgba(255,180,0,0.35)"
    : "rgba(255,180,0,0.15)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(
      sunX + Math.cos(angle) * (iconSize + 2),
      sunY + Math.sin(angle) * (iconSize + 2)
    );
    ctx.lineTo(
      sunX + Math.cos(angle) * (iconSize + 6),
      sunY + Math.sin(angle) * (iconSize + 6)
    );
    ctx.stroke();
  }

  const moonAngle = (18 / 24) * Math.PI * 2 - Math.PI / 2;
  const moonX = cx + Math.cos(moonAngle) * (r - 36);
  const moonY = cy + Math.sin(moonAngle) * (r - 36);
  ctx.fillStyle = isDaytime
    ? "rgba(150,150,200,0.2)"
    : "rgba(200,200,240,0.35)";
  ctx.beginPath();
  ctx.arc(moonX, moonY, iconSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = bgInner;
  ctx.beginPath();
  ctx.arc(moonX + 5, moonY - 3, iconSize - 2, 0, Math.PI * 2);
  ctx.fill();

  for (let hour = 0; hour < 24; hour++) {
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const isMajor = hour % 6 === 0;
    const innerR = isMajor ? r - 18 : r - 10;
    const outerR = r - 2;
    ctx.strokeStyle = isMajor ? majorTickColor : tickColor;
    ctx.lineWidth = isMajor ? 2.5 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.stroke();
  }

  const numerals = [
    { h: 0, label: "1" },
    { h: 6, label: "7" },
    { h: 12, label: "13" },
    { h: 18, label: "19" },
  ];
  ctx.fillStyle = numeralColor;
  ctx.font = `bold ${Math.round(size * 0.058)}px 'Georgia', serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { h, label } of numerals) {
    const angle = (h / 24) * Math.PI * 2 - Math.PI / 2;
    const nr = r - 30;
    ctx.fillText(label, cx + Math.cos(angle) * nr, cy + Math.sin(angle) * nr);
  }

  ctx.font = `${Math.round(size * 0.032)}px 'Georgia', serif`;
  ctx.fillStyle = isDaytime
    ? "rgba(100,80,40,0.45)"
    : "rgba(180,180,220,0.4)";
  const dayLabelAngle = (3 / 24) * Math.PI * 2 - Math.PI / 2;
  ctx.fillText(
    "DAY",
    cx + Math.cos(dayLabelAngle) * (r * 0.52),
    cy + Math.sin(dayLabelAngle) * (r * 0.52)
  );
  const nightLabelAngle = (21 / 24) * Math.PI * 2 - Math.PI / 2;
  ctx.fillText(
    "NIGHT",
    cx + Math.cos(nightLabelAngle) * (r * 0.52),
    cy + Math.sin(nightLabelAngle) * (r * 0.52)
  );

  for (let i = 0; i < 24 * 4; i++) {
    if (i % 4 === 0) continue;
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

  if (hTime) {
    const handAngle = (hTime.totalHours / 24) * Math.PI * 2 - Math.PI / 2;
    const handLen = r - 40;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

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

    const tipX = cx + Math.cos(handAngle) * handLen;
    const tipY = cy + Math.sin(handAngle) * handLen;
    const arrowSize = 8;
    const leftAngle = handAngle + Math.PI - 0.3;
    const rightAngle = handAngle + Math.PI + 0.3;
    ctx.fillStyle = handColor;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX + Math.cos(leftAngle) * arrowSize,
      tipY + Math.sin(leftAngle) * arrowSize
    );
    ctx.lineTo(
      tipX + Math.cos(rightAngle) * arrowSize,
      tipY + Math.sin(rightAngle) * arrowSize
    );
    ctx.closePath();
    ctx.fill();

    ctx.restore();

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

function StatItem({
  label,
  value,
  isDaytime,
}: {
  label: string;
  value: string;
  isDaytime: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div
        style={{
          fontSize: "0.72rem",
          letterSpacing: "0.08em",
          opacity: 0.48,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "0.92rem",
          fontWeight: 600,
          color: isDaytime ? "#5a3e12" : "#ddd7ca",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionTitle({
  children,
}: {
  children: string;
}) {
  return (
    <div
      style={{
        fontSize: "0.74rem",
        letterSpacing: "0.14em",
        opacity: 0.5,
        textTransform: "uppercase",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function MethodSelector({
  method,
  isDaytime,
  onSelect,
}: {
  method: ZmanMethod;
  isDaytime: boolean;
  onSelect: (next: ZmanMethod) => void;
}) {
  return (
    <section>
      <SectionTitle>Method</SectionTitle>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {METHOD_OPTIONS.map((option) => {
          const isActive = option.value === method;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              aria-pressed={isActive}
              style={{
                appearance: "none",
                borderRadius: 999,
                border: isActive
                  ? `1px solid ${isDaytime ? "rgba(122, 87, 26, 0.55)" : "rgba(255, 215, 0, 0.45)"}`
                  : `1px solid ${isDaytime ? "rgba(120, 90, 30, 0.18)" : "rgba(150, 150, 220, 0.14)"}`,
                background: isActive
                  ? isDaytime
                    ? "rgba(255,255,255,0.52)"
                    : "rgba(32,38,62,0.72)"
                  : "transparent",
                color: isDaytime ? "#4a3010" : "#e4dcc8",
                padding: "8px 12px",
                font: "inherit",
                fontSize: "0.88rem",
                cursor: "pointer",
                transition: "background 160ms ease, border-color 160ms ease",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ZmanList({
  entries,
  isDaytime,
  timeZoneId,
}: {
  entries: ZmanEntry[];
  isDaytime: boolean;
  timeZoneId?: string;
}) {
  return (
    <section>
      <SectionTitle>Zmanim</SectionTitle>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {entries.map((entry, index) => (
          <div
            key={entry.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 16,
              paddingTop: index === 0 ? 0 : 10,
              borderTop:
                index === 0
                  ? "none"
                  : `1px solid ${isDaytime ? "rgba(120,90,30,0.1)" : "rgba(150,150,220,0.1)"}`,
            }}
          >
            <div
              style={{
                fontSize: "0.92rem",
                lineHeight: 1.4,
              }}
            >
              {entry.label}
            </div>
            <div
              style={{
                fontSize: "0.92rem",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {fmtZmanTime(entry.time, timeZoneId)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HomeIcon() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M10 21v-5.5h4V21" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function SettingsDrawer({
  open,
  onClose,
  method,
  isDaytime,
  onSelect,
  locationName,
  coordsLabel,
  dayHour,
  nightHour,
  dayLength,
  nightLength,
  day,
  timeZoneId,
}: {
  open: boolean;
  onClose: () => void;
  method: ZmanMethod;
  isDaytime: boolean;
  onSelect: (next: ZmanMethod) => void;
  locationName: string;
  coordsLabel: string;
  dayHour: string;
  nightHour: string;
  dayLength: string;
  nightLength: string;
  day: ZmanimSnapshot["day"] | null;
  timeZoneId?: string;
}) {
  if (!open) return null;

  const drawerBackground = isDaytime
    ? "rgba(245, 234, 208, 0.94)"
    : "rgba(10, 14, 24, 0.94)";
  const drawerBorder = isDaytime
    ? "1px solid rgba(180,150,80,0.24)"
    : "1px solid rgba(100,100,180,0.2)";

  return (
    <>
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          border: "none",
          background: isDaytime ? "rgba(60,40,10,0.12)" : "rgba(0,0,0,0.4)",
          zIndex: 19,
          cursor: "pointer",
        }}
      />
      <aside
        id="settings-panel"
        aria-label="Settings"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 100vw)",
          boxSizing: "border-box",
          padding:
            "calc(env(safe-area-inset-top, 0px) + 18px) 18px calc(env(safe-area-inset-bottom, 0px) + 18px)",
          background: drawerBackground,
          backdropFilter: "blur(16px)",
          borderLeft: drawerBorder,
          boxShadow: isDaytime
            ? "-18px 0 48px rgba(120,90,30,0.14)"
            : "-18px 0 48px rgba(0,0,0,0.35)",
          zIndex: 20,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.72rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                opacity: 0.48,
                marginBottom: 6,
              }}
            >
              Settings
            </div>
            <div
              style={{
                fontSize: "0.98rem",
                lineHeight: 1.5,
                color: isDaytime ? "#4a3010" : "#e8dcc8",
              }}
            >
              <div>{locationName}</div>
              <div style={{ opacity: 0.58 }}>{coordsLabel}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            style={{
              appearance: "none",
              border: drawerBorder,
              background: "transparent",
              borderRadius: 999,
              width: 44,
              height: 44,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: isDaytime ? "#4a3010" : "#e8dcc8",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <CloseIcon />
          </button>
        </div>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 14,
            marginBottom: 24,
          }}
        >
          <StatItem
            label="Sunrise"
            value={day ? fmtZmanTime(day.sunrise, timeZoneId) : "--"}
            isDaytime={isDaytime}
          />
          <StatItem
            label="Sunset"
            value={day ? fmtZmanTime(day.sunset, timeZoneId) : "--"}
            isDaytime={isDaytime}
          />
          <StatItem label="Day Hour" value={dayHour} isDaytime={isDaytime} />
          <StatItem label="Night Hour" value={nightHour} isDaytime={isDaytime} />
          <StatItem label="Day Length" value={dayLength} isDaytime={isDaytime} />
          <StatItem
            label="Night Length"
            value={nightLength}
            isDaytime={isDaytime}
          />
        </section>

        <div style={{ marginBottom: 24 }}>
          <MethodSelector
            method={method}
            isDaytime={isDaytime}
            onSelect={onSelect}
          />
        </div>

        {day ? (
          <ZmanList
            entries={day.zmanim}
            isDaytime={isDaytime}
            timeZoneId={timeZoneId}
          />
        ) : null}
      </aside>
    </>
  );
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [coords, setCoords] = useState<Coords>(TEMPLE_MOUNT);
  const [locationName, setLocationName] = useState("Temple Mount, Jerusalem");
  const [engineReady, setEngineReady] = useState(false);
  const [civilTime, setCivilTime] = useState(new Date());
  const [snapshot, setSnapshot] = useState<ZmanimSnapshot | null>(null);
  const [method, setMethod] = useState<ZmanMethod>(() => readStoredMethod());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canvasSize, setCanvasSize] = useState(340);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const widgetMode = isWidgetMode();

  useEffect(() => {
    function updateSize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      let nextCanvasSize = widgetMode ? 210 : 360;

      setViewportHeight(height);

      if (widgetMode) {
        if (width < 360) nextCanvasSize = 170;
        else if (width < 520) nextCanvasSize = 190;
        return setCanvasSize(nextCanvasSize);
      }

      if (height < 760) {
        if (width < 400) nextCanvasSize = 250;
        else if (width < 600) nextCanvasSize = 280;
        else nextCanvasSize = 310;
      } else if (width < 400) nextCanvasSize = 280;
      else if (width < 640) nextCanvasSize = 320;

      setCanvasSize(nextCanvasSize);
    }

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [widgetMode]);

  useEffect(() => {
    loadZmanimEngine()
      .then(() => setEngineReady(true))
      .catch(() => console.error("Could not load zmanim engine"));
  }, []);

  useEffect(() => {
    persistMethod(method);
  }, [method]);

  useEffect(() => {
    if (!settingsOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationName("Current location");
      },
      () => {
        // Keep the Temple Mount default when geolocation is denied.
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (coords.lat === TEMPLE_MOUNT.lat && coords.lng === TEMPLE_MOUNT.lng) {
      setLocationName("Temple Mount, Jerusalem");
      return;
    }

    const controller = new AbortController();
    reverseGeocode(coords, controller.signal)
      .then((name) => {
        if (name) {
          setLocationName(name);
        }
      })
      .catch(() => {
        // Keep the fallback label when reverse geocoding is unavailable.
      });

    return () => controller.abort();
  }, [coords]);

  useEffect(() => {
    let timeoutId: number | undefined;

    function tick() {
      const now = new Date();
      setCivilTime(now);

      if (!engineReady) {
        setSnapshot(null);
        return;
      }

      setSnapshot(calculateZmanimSnapshot(now, coords, method, locationName));
    }

    function scheduleNextTick() {
      const delay = 1000 - (Date.now() % 1000) + CLOCK_TICK_BUFFER_MS;
      timeoutId = window.setTimeout(() => {
        tick();
        scheduleNextTick();
      }, delay);
    }

    tick();
    scheduleNextTick();

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [coords, engineReady, locationName, method]);

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

    drawClock(
      ctx,
      canvasSize,
      snapshot?.halachicTime ?? null,
      snapshot?.halachicTime.isDaytime ?? true
    );
  }, [canvasSize, snapshot]);

  const isDaytime = snapshot?.halachicTime.isDaytime ?? true;
  const isCompactViewport = viewportHeight < 860;
  const appBackground = isDaytime
    ? "linear-gradient(180deg, #f5ead0 0%, #eadab5 42%, #dcc286 100%)"
    : "linear-gradient(180deg, #0c1016 0%, #161b23 48%, #212849 100%)";
  const appTextColor = isDaytime ? "#3e2c10" : "#d6d0c4";
  const panelBackground = isDaytime
    ? "rgba(255,255,255,0.34)"
    : "rgba(20,24,40,0.58)";
  const panelBorder = isDaytime
    ? "1px solid rgba(180,150,80,0.2)"
    : "1px solid rgba(100,100,180,0.15)";

  useEffect(() => {
    document.documentElement.style.background = appBackground;
    document.body.style.background = appBackground;
    document.body.style.color = appTextColor;
  }, [appBackground, appTextColor]);

  const day = snapshot?.day ?? null;
  const halachicTime = snapshot?.halachicTime ?? null;
  const timeZoneId = snapshot?.timeZoneId;
  const displayHour = halachicTime ? getDisplayHour(halachicTime.hour) : null;
  const halachicDigital = halachicTime
    ? `${pad(displayHour ?? 0)}:${pad(halachicTime.minute)}:${pad(halachicTime.second)}`
    : "--:--:--";
  const specialEvent = snapshot?.specialEvent ?? null;
  const headerDate = snapshot
    ? `${snapshot.gregorianDay} · ${snapshot.hebrewDate}`
    : `${formatWeekday(civilTime)} · ${formatHebrewDate(civilTime, null)}`;
  const currentLocation = locationName;
  const currentCoords = formatCoords(coords);
  const dayHour = day ? `${(day.dayHourMs / 60_000).toFixed(1)} min` : "--";
  const nightHour = halachicTime
    ? `${(halachicTime.nightHourMs / 60_000).toFixed(1)} min`
    : day
      ? `${(day.nightHourMs / 60_000).toFixed(1)} min`
      : "--";
  const dayLength = day ? formatDuration(day.dayLengthMs) : "--";
  const nightLength = halachicTime
    ? formatDuration(halachicTime.nightHourMs * 12)
    : day
      ? formatDuration(day.nightLengthMs)
      : "--";
  const halachicHourSummary = halachicTime
    ? `${halachicTime.currentHourLabel} hour ${halachicTime.currentHourNumber} / 12`
    : "Current halachic hour";
  const panelStyle: CSSProperties = {
    background: panelBackground,
    backdropFilter: "blur(8px)",
    border: panelBorder,
    borderRadius: 20,
    padding: widgetMode ? "16px 18px" : isCompactViewport ? "18px 20px" : "22px 24px",
    boxShadow: isDaytime
      ? "0 8px 30px rgba(120,90,30,0.12)"
      : "0 8px 30px rgba(0,0,0,0.28)",
  };

  if (widgetMode) {
    return (
      <div
        className="app-shell"
      style={{
          minHeight: "100dvh",
          padding: "16px",
          boxSizing: "border-box",
          fontFamily: "'Georgia', 'Times New Roman', serif",
          background: appBackground,
          color: appTextColor,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <section style={panelStyle}>
            <div
              style={{
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: "0.72rem",
                  letterSpacing: "0.14em",
                  opacity: 0.52,
                  textTransform: "uppercase",
                }}
              >
                Halachic Clock
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: "0.86rem",
                  lineHeight: 1.5,
                  opacity: 0.72,
                }}
              >
                {currentLocation}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 14,
              }}
            >
              <canvas ref={canvasRef} />
            </div>

            <div
              style={{
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "clamp(1.7rem, 8vw, 2.4rem)",
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
                  marginTop: 4,
                  fontSize: "0.78rem",
                  opacity: 0.58,
                }}
              >
                {halachicTime ? halachicHourSummary : "Halachic time"}
              </div>
            </div>
          </section>

          <section style={panelStyle}>
            <div
              style={{
                fontSize: "0.78rem",
                opacity: 0.46,
                textAlign: "center",
              }}
            >
              {currentCoords}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      style={{
        minHeight: "100%",
        padding: "24px 16px 40px",
        boxSizing: "border-box",
        fontFamily: "'Georgia', 'Times New Roman', serif",
        background: appBackground,
        color: appTextColor,
      }}
    >
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        method={method}
        isDaytime={isDaytime}
        onSelect={setMethod}
        locationName={currentLocation}
        coordsLabel={currentCoords}
        dayHour={dayHour}
        nightHour={nightHour}
        dayLength={dayLength}
        nightLength={nightLength}
        day={day}
        timeZoneId={timeZoneId}
      />

      <a
        className="home-link"
        href="https://shacharkoller.com"
        aria-label="Go home to shacharkoller.com"
        style={{
          color: isDaytime ? "rgba(74, 48, 16, 0.42)" : "rgba(232, 220, 200, 0.38)",
        }}
      >
        <HomeIcon />
      </a>

      <button
        type="button"
        className="settings-link"
        aria-label="Open settings"
        aria-expanded={settingsOpen}
        aria-controls="settings-panel"
        onClick={() => setSettingsOpen(true)}
        style={{
          color: isDaytime ? "rgba(74, 48, 16, 0.42)" : "rgba(232, 220, 200, 0.38)",
        }}
      >
        <SettingsIcon />
      </button>

      <div
        style={{
          width: "100%",
          maxWidth: 560,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <header
          style={{
            textAlign: "center",
            paddingTop: 24,
          }}
        >
          <div
            style={{
              fontSize: "0.78rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              opacity: 0.58,
            }}
          >
            {headerDate}
          </div>

          {specialEvent ? (
            <div
              style={{
                marginTop: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 999,
                background: isDaytime
                  ? "rgba(255,255,255,0.3)"
                  : "rgba(22,28,44,0.6)",
                border: panelBorder,
                fontSize: "0.86rem",
              }}
            >
              <span style={{ opacity: 0.62 }}>{specialEvent.label}</span>
              <span style={{ fontWeight: 600 }}>
                {fmtZmanTime(specialEvent.time, timeZoneId)}
              </span>
            </div>
          ) : null}

          <h1
            style={{
              fontSize: "clamp(1.5rem, 5vw, 2rem)",
              fontWeight: 700,
              margin: "18px 0 6px",
              letterSpacing: "0.03em",
              color: isDaytime ? "#4a3010" : "#e8dcc8",
            }}
          >
            שעות זמניות
          </h1>
          <div
            style={{
              fontSize: "0.94rem",
              opacity: 0.72,
              lineHeight: 1.6,
            }}
          >
            <div>{currentLocation}</div>
          </div>
        </header>

        <section
          style={{
            ...panelStyle,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: 4,
            }}
          >
            <canvas ref={canvasRef} />
          </div>

          <div
            style={{
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                opacity: 0.54,
                marginBottom: 6,
              }}
            >
              Halachic Time
            </div>
            <div
              style={{
                fontSize: "clamp(2rem, 8vw, 3rem)",
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
                marginTop: 6,
                fontSize: "0.84rem",
                opacity: 0.58,
                lineHeight: 1.6,
              }}
            >
              <div>{halachicHourSummary}</div>
              <div>Civil time · {fmtClockTime(civilTime, timeZoneId)}</div>
            </div>
          </div>

        </section>
      </div>
    </div>
  );
}
