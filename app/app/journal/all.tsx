// app/journal/all.tsx
import React, { useEffect, useState } from "react";
import { SafeAreaView, Text, FlatList, View, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Link } from "expo-router";

const JOURNAL_KEY = "JOURNAL_V2";

type Entry = {
  id: string;
  activityId: number;
  dateISO: string;
  text: string;
};

export default function AllNotes() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(JOURNAL_KEY);
      const all: Entry[] = raw ? JSON.parse(raw) : [];
      all.sort((a, b) => +new Date(b.dateISO) - +new Date(a.dateISO));
      setEntries(all);
    })();
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, padding: 16, gap: 12, backgroundColor: "#f7f8fa" }}>
      <Text style={{ fontSize: 24, fontWeight: "800" }}>All Notes</Text>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => (
          <Link href={{ pathname: "/journal/[id]", params: { id: String(item.activityId) } }} asChild>
            <View style={styles.card}>
              <Text style={styles.date}>{new Date(item.dateISO).toLocaleString()}</Text>
              <Text style={styles.meta}>Activity {item.activityId}</Text>
              <Text>{item.text}</Text>
            </View>
          </Link>
        )}
        ListEmptyComponent={<Text style={{ color: "#6b7280" }}>No notes yet.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, borderRadius: 12, backgroundColor: "#fff", gap: 6, marginBottom: 10 },
  date: { color: "#6b7280", fontSize: 12 },
  meta: { color: "#6b7280", fontSize: 12 },
});
