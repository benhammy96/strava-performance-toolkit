// app/index.tsx
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Rect, G, Text as SvgText } from "react-native-svg";
import { Link } from "expo-router";

WebBrowser.maybeCompleteAuthSession();
const DEFAULT_SERVER = Platform.select({
  ios: "http://localhost:4000",     
  android: "http://10.0.2.2:4000",  
  default: "http://localhost:4000",  
});

// For physical devices, you can override this with environment variables
// or use your computer's IP address like: http://192.168.1.100:4000
const SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? DEFAULT_SERVER;

// Server connection test (uncomment for debugging)
// fetch(`${SERVER}/health`)
//   .then(r => r.json())
//   .then(data => console.log("Server health check:", data))
//   .catch(err => console.log("Server connection failed:", err.message));

const REDIRECT_URI = Linking.createURL("auth");
const USER_KEY = "userId";
const MOOD_KEY = "moods:v1";
const UNIT_KEY = "unit:system";

type Act = {
  id: number;
  name: string;
  type: string;
  distance: number;
  moving_time: number;
  start_date_local: string;
};


const metersToKm = (m: number) => m / 1000;
const metersToMiles = (m: number) => m * 0.000621371;
const kmToMiles = (km: number) => km * 0.621371;
const mpsToKph = (mps: number) => mps * 3.6;
const mpsToMph = (mps: number) => mps * 2.236936;

const formatPace = (meters: number, seconds: number, useImperial: boolean) => {
  if (!meters || !seconds) return "-";
  const speedMps = meters / seconds;
  //pace = minutes per unit
  const secsPerKm = 1000 / speedMps;
  const secsPerMi = 1609.344 / speedMps;
  const secs = useImperial ? secsPerMi : secsPerKm;
  const min = Math.floor(secs / 60);
  const sec = Math.round(secs % 60).toString().padStart(2, "0");
  return `${min}:${sec}/${useImperial ? "mi" : "km"}`;
};

const formatSpeed = (meters: number, seconds: number, useImperial: boolean) => {
  if (!meters || !seconds) return "-";
  const speedMps = meters / seconds;
  const v = useImperial ? mpsToMph(speedMps) : mpsToKph(speedMps);
  return `${v.toFixed(1)} ${useImperial ? "mph" : "km/h"}`;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
};

type BarPoint = { week: string; km: number };

function SimpleBarChart({
  data,
  height = 160,
  padding = 16,
  unitShort = "km",
}: {
  data: BarPoint[];
  height?: number;
  padding?: number;
  unitShort?: "km" | "mi";
}) {
  const width = 320; 
  const max = Math.max(1, ...data.map((d) => d.km));
  const barGap = 10;
  const count = data.length;
  const innerWidth = width - padding * 2;
  const barWidth = (innerWidth - barGap * (count - 1)) / count;
  const chartBottom = height - padding * 2;

  const label = (v: number) => `${v.toFixed(0)} ${unitShort}`;

  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* y-axis label ticks (0, max/2, max) */}
      <SvgText x={padding - 6} y={height - padding} fontSize="10" textAnchor="end" fill="#6b7280">
        {label(0)}
      </SvgText>
      <SvgText
        x={padding - 6}
        y={height - padding - chartBottom / 2}
        fontSize="10"
        textAnchor="end"
        fill="#6b7280"
      >
        {label(max / 2)}
      </SvgText>
      <SvgText x={padding - 6} y={padding} fontSize="10" textAnchor="end" fill="#6b7280">
        {label(max)}
      </SvgText>

      <G x={padding} y={padding}>
        {data.map((d, i) => {
          const h = (d.km / max) * chartBottom;
          const x = i * (barWidth + barGap);
          const y = chartBottom - h;
          return (
            <G key={i}>
              <Rect x={x} y={y} width={barWidth} height={h} rx={4} />
              <SvgText x={x + barWidth / 2} y={chartBottom + 12} fontSize="10" textAnchor="middle" fill="#6b7280">
                {d.week}
              </SvgText>
            </G>
          );
        })}
      </G>
    </Svg>
  );
}

export default function HomeScreen() {
  const [userId, setUserId] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [acts, setActs] = useState<Act[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moods, setMoods] = useState<Record<string, string>>({});

  //miles/meters toggle
  const [useImperial, setUseImperial] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(UNIT_KEY).then((v) => {
      if (v === "imperial") setUseImperial(true);
      else if (v === "metric") setUseImperial(false);
    });
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(UNIT_KEY, useImperial ? "imperial" : "metric").catch(() => {});
  }, [useImperial]);

  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const loadNoteCounts = useCallback(async () => {
    const raw = await AsyncStorage.getItem("JOURNAL_V2");
    const all: { activityId: number }[] = raw ? JSON.parse(raw) : [];
    const counts: Record<string, number> = {};
    for (const e of all) {
      const k = String(e.activityId);
      counts[k] = (counts[k] || 0) + 1;
    }
    setNoteCounts(counts);
  }, []);

  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      const { queryParams } = Linking.parse(url);
      if (queryParams?.userId) {
        const id = String(queryParams.userId);
        setUserId(id);
        AsyncStorage.setItem(USER_KEY, id).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(USER_KEY);
      if (saved) setUserId(saved);
      const moodJson = await AsyncStorage.getItem(MOOD_KEY);
      if (moodJson) setMoods(JSON.parse(moodJson));
      const url = await Linking.getInitialURL();
      if (url) {
        const { queryParams } = Linking.parse(url);
        if (queryParams?.userId) {
          const id = String(queryParams.userId);
          setUserId(id);
          AsyncStorage.setItem(USER_KEY, id).catch(() => {});
        }
      }
    })();
  }, []);

  const login = async () => {
    setError(null);
    const authUrl = `${SERVER}/auth/strava/start?app_redirect=${encodeURIComponent(REDIRECT_URI)}`;
    await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);
  };

  const fetchProfile = useCallback(async () => {
    if (!userId) return;
    const r = await fetch(`${SERVER}/me/${userId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    setProfile(data);
  }, [userId]);

  const fetchActivities = useCallback(async () => {
    if (!userId) return;
    const r = await fetch(`${SERVER}/activities/${userId}?per_page=60`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data: Act[] = await r.json();
    data.sort((a, b) => +new Date(b.start_date_local) - +new Date(a.start_date_local));
    setActs(data);
  }, [userId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchProfile(), fetchActivities()]);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [fetchProfile, fetchActivities]);

  useEffect(() => {
    if (userId) loadAll();
  }, [userId, loadAll]);

  useEffect(() => {
    loadNoteCounts();
  }, [acts, loadNoteCounts]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
      await loadNoteCounts();
    } finally {
      setRefreshing(false);
    }
  };

  //consistency, streak buckets
  const { weekBuckets, consistency, streak, unitShort } = useMemo(() => {
    const now = new Date();
    const thisWeek = startOfWeek(now); //starts on sunday
    const weeks: Date[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(thisWeek);
      d.setDate(d.getDate() - i * 7);
      weeks.push(d);
    }
    const wkLabels = weeks.map((w) => ymd(w)); // keys

    //tracking totals
    const totalsMeters: Record<string, number> = {};
    wkLabels.forEach((k) => (totalsMeters[k] = 0));

    acts.forEach((a) => {
      const d = new Date(a.start_date_local);
      const wk = startOfWeek(d);
      const key = ymd(wk);
      if (key in totalsMeters) totalsMeters[key] += a.distance;
    });

    const toUnit = (m: number) => (useImperial ? metersToMiles(m) : metersToKm(m));
    const weekBuckets: BarPoint[] = wkLabels.map((k) => ({
      week: k.slice(5), // MM-DD
      km: Number(toUnit(totalsMeters[k]).toFixed(2)), 
    }));

    //consistency score, looks at weeks
    const vals = weekBuckets.map((b) => b.km);
    const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (vals.length || 1);
    const std = Math.sqrt(variance);
    const cov = mean > 0 ? std / mean : 1; // smaller is better
    const consistency = Math.round(100 * (1 / (1 + cov))); // 0..100

    //daily streak (consecutive days with an activity)
    const daysWith = new Set(acts.map((a) => ymd(new Date(a.start_date_local))));
    let s = 0;
    for (let i = 0; i < 365; i++) {
      const day = new Date();
      day.setDate(day.getDate() - i);
      const key = ymd(day);
      if (daysWith.has(key)) s++;
      else break;
    }

    return { weekBuckets, consistency, streak: s, unitShort: useImperial ? "mi" : "km" as "mi" | "km" };
  }, [acts, useImperial]);

  const setMood = async (id: number, m: string) => {
    const next = { ...moods, [String(id)]: m };
    setMoods(next);
    await AsyncStorage.setItem(MOOD_KEY, JSON.stringify(next));
  };

  const distanceLabel = (meters: number) =>
    useImperial ? `${metersToMiles(meters).toFixed(2)} mi` : `${metersToKm(meters).toFixed(2)} km`;

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        data={acts}
        keyExtractor={(a) => String(a.id)}
        refreshing={refreshing}
        onRefresh={onRefresh}
        contentContainerStyle={{
          padding: 16,
          gap: 12,
          paddingBottom: 32,
          backgroundColor: "#f7f8fa",
        }}
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Strava Project</Text>

              {/* Unit toggle pill */}
              <TouchableOpacity
                onPress={() => setUseImperial((v) => !v)}
                style={styles.unitToggle}
                accessibilityLabel="Toggle units"
              >
                <Text style={styles.unitToggleText}>
                  {useImperial ? "Imperial (mi, mph)" : "Metric (km, km/h)"}
                </Text>
                <Text style={styles.unitToggleHint}>Tap to switch</Text>
              </TouchableOpacity>
            </View>

            {/* Login & user box */}
            <View style={styles.card}>
              <TouchableOpacity style={styles.primaryBtn} onPress={login}>
                <Text style={styles.primaryBtnText}>Connect Strava</Text>
              </TouchableOpacity>

              <Text style={styles.subtle}>You’ll be bounced back here automatically after approving.</Text>

              <TextInput
                placeholder="userId (auto-fills after login)"
                value={userId}
                onChangeText={(t) => {
                  setUserId(t);
                  AsyncStorage.setItem(USER_KEY, t).catch(() => {});
                }}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />

              {!!error && <Text style={styles.error}>Error: {error}</Text>}
              {loading && (
                <View style={styles.loading}>
                  <ActivityIndicator />
                </View>
              )}
            </View>

            {/* Consistency + Streaks */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Consistency & Streak</Text>
              <View style={styles.row}>
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>Consistency</Text>
                  <Text style={styles.badgeValue}>{consistency}</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeLabel}>Streak</Text>
                  <Text style={styles.badgeValue}>{streak}d</Text>
                </View>
              </View>

              <View style={{ height: 160, marginTop: 10 }}>
                <SimpleBarChart data={weekBuckets} unitShort={unitShort} />
              </View>
            </View>

            {/* Profile info */}
            {profile && (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Athlete</Text>
                <Text style={{ fontSize: 18, fontWeight: "700" }}>
                  {profile.firstname} {profile.lastname}
                </Text>
                <Text style={styles.subtle}>
                  {profile.city}
                  {profile.city && profile.country ? ", " : ""}
                  {profile.country}
                </Text>
              </View>
            )}

            {/* Section header for activities */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Recent activities</Text>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { paddingTop: 0 }]}>
            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{item.name || item.type}</Text>
                <Text style={styles.itemMeta}>
                  {item.type} • {new Date(item.start_date_local).toLocaleDateString()}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.itemStat}>{distanceLabel(item.distance)}</Text>
                <Text style={styles.itemMeta}>
                  {formatPace(item.distance, item.moving_time, useImperial)}
                  {"  •  "}
                  {formatSpeed(item.distance, item.moving_time, useImperial)}
                </Text>

                <View style={styles.moodRow}>
                  {["🔥", "🙂", "😓"].map((emoji) => (
                    <TouchableOpacity key={emoji} onPress={() => setMood(item.id, emoji)}>
                      <Text style={[styles.mood, moods[String(item.id)] === emoji && styles.moodActive]}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}

                  {/* Journal deep link */}
                  <Link href={{ pathname: "/journal/[id]", params: { id: String(item.id) } }} asChild>
                    <TouchableOpacity accessibilityLabel="Journal about this activity">
                      <Text style={[styles.mood, { opacity: 1 }]}>📝</Text>
                    </TouchableOpacity>
                  </Link>

                  {/* Notes count */}
                  {!!noteCounts[String(item.id)] && (
                    <Text style={[styles.itemMeta, { marginLeft: 6 }]}>x{noteCounts[String(item.id)]}</Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !loading ? <Text style={[styles.subtle, { paddingHorizontal: 16 }]}>No activities yet.</Text> : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: "#f7f8fa" },
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
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e6e7ea",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fafafa",
  },
  primaryBtn: {
    backgroundColor: "#FC4C02",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  row: { flexDirection: "row", gap: 10, alignItems: "center" },
  badge: { backgroundColor: "#f4f5f7", padding: 10, borderRadius: 12, alignItems: "center", minWidth: 110 },
  badgeLabel: { fontSize: 12, color: "#6b7280" },
  badgeValue: { fontSize: 20, fontWeight: "800" },
  subtle: { color: "#6b7280", fontSize: 12 },
  sectionTitle: { fontWeight: "800" },
  item: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f1f5",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  itemTitle: { fontWeight: "700" },
  itemMeta: { color: "#6b7280", fontSize: 12 },
  itemStat: { fontWeight: "800" },
  loading: { paddingTop: 4 },
  moodRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  mood: { fontSize: 16, opacity: 0.4 },
  moodActive: { opacity: 1, transform: [{ scale: 1.1 }] },
  error: { color: "#d32f2f", fontSize: 13, marginTop: 4 },
});
