// app/journal/index.tsx
import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView, View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl
} from "react-native";
import { Link } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Act = {
  id: number;
  name: string;
  type: string;
  distance: number;
  moving_time: number;
  start_date_local: string;
};

//use environment variable or fallback to localhost
const SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? "http://localhost:4000";
const USER_KEY = "userId";

const km = (m: number) => m / 1000;
const pace = (meters: number, seconds: number) => {
  if (!meters || !seconds) return "-";
  const minPerKm = (seconds / 60) / (meters / 1000);
  const min = Math.floor(minPerKm);
  const sec = Math.round((minPerKm - min) * 60).toString().padStart(2, "0");
  return `${min}:${sec}/km`;
};

export default function JournalPicker() {
  const [acts, setActs] = useState<Act[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const r = await fetch(`${SERVER}/activities/${userId}?per_page=60`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: Act[] = await r.json();
      data.sort((a, b) => +new Date(b.start_date_local) - +new Date(a.start_date_local));
      setActs(data);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(USER_KEY);
      if (saved) setUserId(saved);
    })();
  }, []);

  useEffect(() => { if (userId) fetchActivities(); }, [userId, fetchActivities]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchActivities();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Pick an activity to journal</Text>
      {!!error && <Text style={styles.error}>Error: {error}</Text>}
      {loading && <ActivityIndicator />}

      <FlatList
        data={acts}
        keyExtractor={(a) => String(a.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <Link
            href={{
              pathname: "/journal/[id]",
              params: { id: String(item.id) }
            }}
            asChild
          >
            <TouchableOpacity style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{item.name || item.type}</Text>
                <Text style={styles.itemMeta}>
                  {item.type} • {new Date(item.start_date_local).toLocaleString()}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.itemStat}>{km(item.distance).toFixed(2)} km</Text>
                <Text style={styles.itemMeta}>{pace(item.distance, item.moving_time)}</Text>
                <Text style={styles.cta}>Journal →</Text>
              </View>
            </TouchableOpacity>
          </Link>
        )}
        ListEmptyComponent={!loading ? <Text style={styles.subtle}>No activities found.</Text> : null}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: "#f7f8fa" },
  title: { fontSize: 24, fontWeight: "800" },
  card: {
    padding: 14, borderRadius: 14, backgroundColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 2, gap: 8, marginBottom: 10, flexDirection: "row", alignItems: "center",
  },
  itemTitle: { fontWeight: "700" },
  itemMeta: { color: "#6b7280", fontSize: 12 },
  itemStat: { fontWeight: "800" },
  subtle: { color: "#6b7280", fontSize: 12, textAlign: "center", marginTop: 20 },
  error: { color: "#d32f2f", fontSize: 13, marginTop: 4 },
  cta: { marginTop: 6, fontWeight: "700" }
});
