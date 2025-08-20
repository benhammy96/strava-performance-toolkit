import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  SafeAreaView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

//use environment variable or fallback to localhost
const SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? "http://localhost:4000";
const USER_KEY = "userId";
const UNIT_KEY = "unit:system"; 

function kmToMi(km: number) { return km * 0.621371; }
function miToKm(mi: number) { return mi / 0.621371; }

export default function PerformanceScreen() {
  const bg = "#fff";
  const fg = "#000";
  const sub = "#6b7280";
  const card = "#fafafa";
  const border = "#e5e7eb";
  const primary = "#000"; 
  const primaryText = "#fff";

  const [unit, setUnit] = useState<"km" | "mi">("km");
  const [distance, setDistance] = useState("5");
  const [userId, setUserId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(USER_KEY).then(setUserId);
    AsyncStorage.getItem(UNIT_KEY).then((v) => {
      if (v === "km" || v === "mi") setUnit(v);
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(UNIT_KEY, unit).catch(() => {});
  }, [unit]);

  const distKm = useMemo(() => {
    const v = parseFloat(distance);
    if (isNaN(v) || v <= 0) return 0;
    return unit === "km" ? v : miToKm(v);
  }, [unit, distance]);

  const predict = async () => {
    try {
      setError(null);
      setRes(null);
      if (!userId) throw new Error("Please connect Strava first.");
      if (!distKm) throw new Error("Enter a valid distance.");

      setLoading(true);
      const r = await fetch(`${SERVER}/api/predict?distance_km=${distKm.toFixed(3)}`, {
        headers: { "x-user-id": userId },
      });
      const ct = r.headers.get("content-type") || "";
      const txt = await r.text();

      if (!ct.includes("application/json")) {
        throw new Error(`Server error (${r.status}).`);
      }
      const j = JSON.parse(txt);
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

      setRes(j);
    } catch (e: any) {
      const msg = e?.message ?? "Prediction failed";
      setError(msg);
      Alert.alert("Prediction error", msg);
    } finally {
      setLoading(false);
    }
  };

  const paceMi = useMemo(() => {
    if (!res?.prediction_seconds || !res?.distance_km) return null;
    const secPerMi = res.prediction_seconds / kmToMi(res.distance_km);
    const mm = Math.floor(secPerMi / 60);
    const ss = Math.round(secPerMi % 60);
    return `${mm}:${ss.toString().padStart(2, "0")}/mi`;
  }, [res]);

  const presets = unit === "km"
    ? [{ label: "5K", v: "5" }, { label: "10K", v: "10" }, { label: "Half", v: "21.1" }, { label: "Full", v: "42.2" }]
    : [{ label: "5K", v: "3.1" }, { label: "10K", v: "6.2" }, { label: "Half", v: "13.1" }, { label: "Full", v: "26.2" }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, backgroundColor: bg, flexGrow: 1 }}>
        <Text style={{ fontSize: 24, fontWeight: "800", color: fg, marginTop: 8 }}>
          Performance Predictor
        </Text>

        {/* Controls card */}
        <View style={{
          backgroundColor: card, borderColor: border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 12
        }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Text style={{ color: fg, fontSize: 16 }}>Distance</Text>
            <TextInput
              value={distance}
              onChangeText={setDistance}
              keyboardType="decimal-pad"
              placeholder={unit === "km" ? "e.g. 5" : "e.g. 3.1"}
              placeholderTextColor={sub}
              style={{
                flexGrow: 1,
                borderWidth: 1,
                borderColor: border,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: fg,
                backgroundColor: "#fff",
              }}
            />
            <TouchableOpacity
              onPress={() => setUnit(u => (u === "km" ? "mi" : "km"))}
              style={{ borderWidth: 1, borderColor: border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
            >
              <Text style={{ color: fg, fontWeight: "600" }}>{unit.toUpperCase()}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={predict}
              style={{ backgroundColor: primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 }}
            >
              <Text style={{ color: primaryText, fontWeight: "700" }}>Predict</Text>
            </TouchableOpacity>
          </View>

          {/* Presets */}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {presets.map(p => (
              <TouchableOpacity
                key={p.label}
                onPress={() => setDistance(p.v)}
                style={{
                  borderWidth: 1,
                  borderColor: border,
                  backgroundColor: "#fff",
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                }}
              >
                <Text style={{ color: fg, fontWeight: "600" }}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Result card */}
        <View style={{
          backgroundColor: card, borderColor: border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 8
        }}>
          {loading && <ActivityIndicator />}
          {!loading && error && <Text style={{ color: "#ef4444" }}>{error}</Text>}

          {!loading && !error && res && (
            <>
              <Text style={{ color: fg, fontSize: 18, fontWeight: "700" }}>
                {unit === "km" ? `${res.distance_km.toFixed(2)} km` : `${kmToMi(res.distance_km).toFixed(2)} mi`}
              </Text>
              <Text style={{ color: fg, fontSize: 16 }}>
                Predicted time: <Text style={{ fontWeight: "800" }}>{res.prediction_time}</Text>
              </Text>
              <Text style={{ color: fg }}>
                Likely range: {res.confidence_low_time} – {res.confidence_high_time}
              </Text>
              <Text style={{ color: fg }}>
                Pace: {res.pace_per_km}{paceMi ? ` (≈ ${paceMi})` : ""}
              </Text>
            </>
          )}

          {!loading && !res && !error && (
            <Text style={{ color: sub }}>
              Enter a distance and tap Predict.
            </Text>
          )}
        </View>

        <Text style={{ color: sub, fontSize: 12 }}>
          Uses a recency-weighted model across your past runs. More steady runs → tighter range.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
