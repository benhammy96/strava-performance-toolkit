// app/run-planner.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  Platform,
} from "react-native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const DEFAULT_SERVER = Platform.select({
  ios: "http://localhost:4000",
  android: "http://10.0.2.2:4000",
  default: "http://localhost:4000",
});

// For physical devices, you can override this with environment variables
// or use your computer's IP address like: http://192.168.1.100:4000
const SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? DEFAULT_SERVER;

// Debug logging (uncomment if needed)
// console.log("Run Planner - Platform:", Platform.OS, "SERVER:", SERVER);

type Hour = {
  ts: number;
  temp_c: number;
  humidity: number;
  wind_kph: number;
  pop: number;
  uv: number;
  aqi?: number | null;
};

type Current = {
  temp_c: number;
  condition: string;
  uv: number;
  aqi_like: number | null;
};

const UNIT_KEY = "unitSystem:v1";

export default function RunPlanner() {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [hours, setHours] = useState<Hour[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [useMetric, setUseMetric] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(UNIT_KEY).then((v) => {
      if (v === "imperial") setUseMetric(false);
      else if (v === "metric") setUseMetric(true);
    });
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(UNIT_KEY, useMetric ? "metric" : "imperial").catch(() => {});
  }, [useMetric]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setErr("Location permission denied.");
          setLoading(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const lat = loc.coords.latitude;
        const lon = loc.coords.longitude;
        setCoords({ lat, lon });

        const r = await fetch(`${SERVER}/weather?lat=${lat}&lon=${lon}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        setHours(j.hours || []);
        setCurrent(j.current || null);
      } catch (e: any) {
        setErr(e.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toF = (c: number) => c * 9 / 5 + 32;
  const toMph = (kph: number) => kph * 0.621371;

  const tempLabel = (c: number) => useMetric ? `${Math.round(c)}°C` : `${Math.round(toF(c))}°F`;
  const windLabel = (kph: number) => useMetric ? `${Math.round(kph)} km/h` : `${Math.round(toMph(kph))} mph`;

  const { withScores, best } = useMemo(() => {
    const scoreHour = (h: Hour) => {
      const tempPenalty = Math.min(1, Math.abs(h.temp_c - 11) / 15);
      const humidityPenalty = Math.max(0, (h.humidity - 50) / 50);
      const windPenalty = Math.min(1, h.wind_kph / 30);
      const rainPenalty = Math.min(1, h.pop || 0);
      const uvPenalty = Math.min(1, (h.uv || 0) / 8);
      const aqiPenalty = h.aqi != null ? Math.min(1, (h.aqi as number) / 150) : 0.2;

      const penalty =
        0.35 * tempPenalty +
        0.15 * humidityPenalty +
        0.15 * windPenalty +
        0.2 * aqiPenalty +
        0.1 * rainPenalty +
        0.05 * uvPenalty;

      return Math.round(100 * (1 - Math.max(0, Math.min(1, penalty))));
    };

    const ws = hours.map((h) => ({ ...h, score: scoreHour(h) }));
    const best = [...ws].sort((a, b) => b.score - a.score).slice(0, 3);
    return { withScores: ws, best };
  }, [hours]);

  const prettyTime = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.headerRow}>
        <Text style={s.title}>Run Planner</Text>

        <TouchableOpacity
          onPress={() => setUseMetric((v) => !v)}
          style={s.unitToggle}
        >
          <Text style={s.unitToggleText}>
            {useMetric ? "Metric (°C, km/h)" : "Imperial (°F, mph)"}
          </Text>
          <Text style={s.unitToggleHint}>Tap to switch</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator />}
      {!!err && <Text style={s.err}>{err}</Text>}

      {current && (
        <View style={s.card}>
          <Text style={s.section}>Now</Text>
          <Text style={s.meta}>
            {tempLabel(current.temp_c)} · {current.condition} · UV {Math.round(current.uv || 0)}
            {current.aqi_like != null ? ` · PM2.5 ~ ${current.aqi_like}` : ""}
          </Text>
        </View>
      )}

      {!!best.length && (
        <View style={s.card}>
          <Text style={s.section}>Best windows (next 24h)</Text>
          {best.map((h) => (
            <View style={s.row} key={h.ts}>
              <Text style={s.time}>{prettyTime(h.ts)}</Text>
              <Text style={s.score}>{h.score}</Text>
              <Text style={s.metaSmall}>
                {tempLabel(h.temp_c)} · {Math.round(h.humidity)}% · {windLabel(h.wind_kph)} · POP {Math.round((h.pop || 0) * 100)}% · UV {Math.round(h.uv || 0)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={withScores}
        keyExtractor={(h) => String(h.ts)}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <View style={s.rowItem}>
            <Text style={s.time}>{prettyTime(item.ts)}</Text>

            <View style={{ flex: 1, marginHorizontal: 8 }}>
              <Text style={s.metaSmall}>
                {tempLabel(item.temp_c)} · {Math.round(item.humidity)}% · {windLabel(item.wind_kph)} · POP {Math.round((item.pop || 0) * 100)}% · UV {Math.round(item.uv || 0)}
              </Text>
              <View style={s.barBg}>
                <View style={[s.bar, { width: `${item.score}%` }]} />
              </View>
            </View>

            <Text style={s.score}>{item.score}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, padding: 16, backgroundColor: "#f7f8fa", gap: 12 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "800" },
  unitToggle: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e6e7ea",
    alignItems: "flex-end",
  },
  unitToggleText: { fontWeight: "700" },
  unitToggleHint: { color: "#6b7280", fontSize: 11, marginTop: 2 },
  card: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  section: { fontWeight: "800", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  rowItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  time: { width: 80, fontWeight: "700" },
  meta: { color: "#111827", fontSize: 12 },
  metaSmall: { color: "#6b7280", fontSize: 11 },
  barBg: { height: 6, backgroundColor: "#eef2f7", borderRadius: 6, marginTop: 4, overflow: "hidden" },
  bar: { height: 6, backgroundColor: "#22c55e" },
  score: { width: 44, textAlign: "right", fontWeight: "800" },
  err: { color: "#d32f2f", fontSize: 13 },
});
