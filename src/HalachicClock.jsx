import React, { useEffect, useRef, useState } from "react";

const SUNCALC_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js";
const FALLBACK_LOCATION = {
  lat: 40.8448,
  lng: -73.9442,
  label: "NYC (fallback)",
};

let sunCalcLoadPromise;

function loadSunCalc() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SunCalc can only load in the browser."));
  }

  if (window.SunCalc) {
    return Promise.resolve(window.SunCalc);
  }

  if (sunCalcLoadPromise) {
    return sunCalcLoadPromise;
  }

  sunCalcLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("suncalc-runtime-script");
    if (existing) {
      existing.addEventListener(
        "load",
        () => {
          if (window.SunCalc) resolve(window.SunCalc);
          else reject(new Error("SunCalc script loaded but global is missing."));
        },
        { once: true }
      );
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load SunCalc script.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = "suncalc-runtime-script";
    script.src = SUNCALC_SRC;
    script.async = true;
    script.onload = () => {
      if (window.SunCalc) resolve(window.SunCalc);
      else reject(new Error("SunCalc script loaded but global is missing."));
    };
    script.onerror = () => reject(new Error("Failed to load SunCalc script."));
    document.body.appendChild(script);
  });

  return sunCalcLoadPromise;
}

function getLocation() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ...FALLBACK_LOCATION, source: "fallback" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "Your location",
          source: "geolocation",
        });
      },
      () => {
        resolve({ ...FALLBACK_LOCATION, source: "fallback" });
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 10 * 60 * 1000,
      }
    );
  });
}

function formatCivilTime(date, includeSeconds = true) {
  if (!date) return "--";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
  });
}

function formatHalachicTime(halachicHour) {
  if (!Number.isFinite(halachicHour)) return "--:--:--";
  const normalized = ((halachicHour % 24) + 24) % 24;
  const totalSeconds = Math.floor(normalized * 3600);
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function angleForHour(hour) {
  return -Math.PI / 2 + (hour / 24) * Math.PI * 2;
}

function drawClock(ctx, size, halachicHour, isDayMode) {
  const center = size / 2;
  const radius = size * 0.43;

  ctx.clearRect(0, 0, size, size);

  const bgGradient = ctx.createRadialGradient(
    center,
    center,
    radius * 0.2,
    center,
    center,
    radius * 1.1
  );
  if (isDayMode) {
    bgGradient.addColorStop(0, "#f0f9ff");
    bgGradient.addColorStop(1, "#dbeafe");
  } else {
    bgGradient.addColorStop(0, "#1e293b");
    bgGradient.addColorStop(1, "#0f172a");
  }

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = bgGradient;
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = isDayMode ? "#7dd3fc" : "#334155";
  ctx.stroke();

  ctx.lineWidth = 14;
  ctx.strokeStyle = isDayMode ? "rgba(14, 165, 233, 0.22)" : "rgba(148, 163, 184, 0.16)";
  ctx.beginPath();
  ctx.arc(center, center, radius - 8, angleForHour(0), angleForHour(12));
  ctx.stroke();

  ctx.strokeStyle = isDayMode ? "rgba(71, 85, 105, 0.14)" : "rgba(148, 163, 184, 0.22)";
  ctx.beginPath();
  ctx.arc(center, center, radius - 8, angleForHour(12), angleForHour(24));
  ctx.stroke();

  for (let i = 0; i < 24; i += 1) {
    const a = angleForHour(i);
    const major = i % 6 === 0;
    const inner = radius - (major ? 22 : 14);
    const outer = radius - 3;

    ctx.beginPath();
    ctx.moveTo(center + Math.cos(a) * inner, center + Math.sin(a) * inner);
    ctx.lineTo(center + Math.cos(a) * outer, center + Math.sin(a) * outer);
    ctx.lineWidth = major ? 3 : 1.5;
    ctx.strokeStyle = isDayMode ? "#334155" : "#cbd5e1";
    ctx.stroke();
  }

  ctx.fillStyle = isDayMode ? "#0f172a" : "#f8fafc";
  ctx.font = "bold 18px ui-sans-serif, system-ui, -apple-system, Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  [0, 6, 12, 18].forEach((h) => {
    const a = angleForHour(h);
    const r = radius - 38;
    ctx.fillText(String(h), center + Math.cos(a) * r, center + Math.sin(a) * r);
  });

  const handAngle = angleForHour(halachicHour);
  ctx.beginPath();
  ctx.moveTo(center, center);
  ctx.lineTo(center + Math.cos(handAngle) * (radius - 32), center + Math.sin(handAngle) * (radius - 32));
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.strokeStyle = isDayMode ? "#0ea5e9" : "#f8fafc";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center, center, 6, 0, Math.PI * 2);
  ctx.fillStyle = isDayMode ? "#0284c7" : "#e2e8f0";
  ctx.fill();
}

export default function HalachicClock() {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [location, setLocation] = useState({ ...FALLBACK_LOCATION, source: "fallback" });
  const [clockData, setClockData] = useState({
    now: new Date(),
    halachicHour: 0,
    isDayMode: true,
    sunrise: null,
    sunset: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [_, loc] = await Promise.all([loadSunCalc(), getLocation()]);
        if (cancelled) return;
        setLocation(loc);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Unable to initialize clock.");
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    function tick() {
      const SunCalc = window.SunCalc;
      if (!SunCalc) return;

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const todayTimes = SunCalc.getTimes(today, location.lat, location.lng);
      const yesterdayTimes = SunCalc.getTimes(yesterday, location.lat, location.lng);
      const tomorrowTimes = SunCalc.getTimes(tomorrow, location.lat, location.lng);

      const sunriseToday = todayTimes.sunrise;
      const sunsetToday = todayTimes.sunset;
      const sunsetYesterday = yesterdayTimes.sunset;
      const sunriseTomorrow = tomorrowTimes.sunrise;

      let halachicHour;
      let isDayMode;

      if (now >= sunriseToday && now < sunsetToday) {
        const dayFraction = (now - sunriseToday) / (sunsetToday - sunriseToday);
        halachicHour = dayFraction * 12;
        isDayMode = true;
      } else if (now < sunriseToday) {
        const nightFraction = (now - sunsetYesterday) / (sunriseToday - sunsetYesterday);
        halachicHour = 12 + nightFraction * 12;
        isDayMode = false;
      } else {
        const nightFraction = (now - sunsetToday) / (sunriseTomorrow - sunsetToday);
        halachicHour = 12 + nightFraction * 12;
        isDayMode = false;
      }

      setClockData({
        now,
        halachicHour: ((halachicHour % 24) + 24) % 24,
        isDayMode,
        sunrise: sunriseToday,
        sunset: sunsetToday,
      });
    }

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [ready, location.lat, location.lng]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 320;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawClock(ctx, size, clockData.halachicHour, clockData.isDayMode);
  }, [clockData]);

  const shellStyle = {
    width: "100%",
    maxWidth: 420,
    borderRadius: 18,
    border: `1px solid ${clockData.isDayMode ? "#bae6fd" : "#334155"}`,
    padding: 20,
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.15)",
    transition: "background-color 250ms ease, color 250ms ease, border-color 250ms ease",
    background: clockData.isDayMode ? "#f0f9ff" : "#0f172a",
    color: clockData.isDayMode ? "#1e293b" : "#f8fafc",
  };

  const secondaryTextColor = clockData.isDayMode ? "#475569" : "#cbd5e1";

  if (loadError) {
    return (
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          margin: "0 auto",
          borderRadius: 16,
          border: "1px solid #fecaca",
          background: "#fef2f2",
          padding: 16,
          color: "#b91c1c",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI",
        }}
      >
        {loadError}
      </div>
    );
  }

  return (
    <div style={shellStyle}>
      <h2
        style={{
          margin: "0 0 16px 0",
          textAlign: "center",
          fontSize: 24,
          fontWeight: 700,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI",
        }}
      >
        Halachic Clock
      </h2>

      <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
        <canvas ref={canvasRef} />
      </div>

      <div
        style={{
          display: "grid",
          gap: 8,
          fontSize: 14,
          lineHeight: 1.4,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI",
        }}
      >
        <p>
          <span style={{ fontWeight: 700 }}>Halachic time:</span> {formatHalachicTime(clockData.halachicHour)}
        </p>
        <p>
          <span style={{ fontWeight: 700 }}>Sunrise:</span> {formatCivilTime(clockData.sunrise, false)}
          {"  "}
          <span style={{ fontWeight: 700 }}>Sunset:</span> {formatCivilTime(clockData.sunset, false)}
        </p>
        <p>
          <span style={{ fontWeight: 700 }}>Civil time:</span> {formatCivilTime(clockData.now)}
        </p>
        <p>
          <span style={{ fontWeight: 700 }}>Location:</span> {location.label}
        </p>
        <p style={{ color: secondaryTextColor }}>
          Sha&apos;ot zmaniyot divide daylight and nighttime into variable 12-hour blocks based on actual
          sunrise and sunset.
        </p>
      </div>
    </div>
  );
}
