// app/journal/[id].tsx
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const JOURNAL_KEY = "JOURNAL_V2";

type Entry = {
  id: string;
  activityId: number;
  dateISO: string;
  text: string;
};

export default function JournalCompose() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const activityId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [activityNotes, setActivityNotes] = useState<Entry[]>([]);

  const listRef = useRef<FlatList<Entry>>(null);
  const inputRef = useRef<TextInput>(null);

  const loadNotes = useCallback(async () => {
    const raw = await AsyncStorage.getItem(JOURNAL_KEY);
    const all: Entry[] = raw ? JSON.parse(raw) : [];
    const mine = all
      .filter((e) => e.activityId === activityId)
      .sort((a, b) => +new Date(b.dateISO) - +new Date(a.dateISO));
    setActivityNotes(mine);
  }, [activityId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const save = useCallback(async () => {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    try {
      const raw = await AsyncStorage.getItem(JOURNAL_KEY);
      const all: Entry[] = raw ? JSON.parse(raw) : [];
      const e: Entry = {
        id: `${Date.now()}`,
        activityId,
        dateISO: new Date().toISOString(),
        text: body,
      };
      await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify([e, ...all]));
      setText("");
      inputRef.current?.blur();
      Keyboard.dismiss();
      await loadNotes();
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
    } finally {
      setSaving(false);
    }
  }, [text, activityId, loadNotes]);

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 60} // 👈 bump it above keyboard
      >
        <Pressable
          style={{ flex: 1 }}
          onPress={() => {
            inputRef.current?.blur();
            Keyboard.dismiss();
          }}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Journal for Activity {activityId}</Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.back}>Back</Text>
            </TouchableOpacity>
          </View>

          {/* Notes list */}
          <FlatList
            ref={listRef}
            data={activityNotes}
            keyExtractor={(e) => e.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 16,
              paddingBottom: 12,
            }}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.entryDate}>
                  {new Date(item.dateISO).toLocaleString()}
                </Text>
                <Text style={styles.entryText}>{item.text}</Text>
              </View>
            )}
          />

          {/* Composer */}
          <View
            style={[
              styles.composerWrap,
              { paddingBottom: (insets.bottom || 8) + 4 }, // tiny extra padding
            ]}
          >
            <TextInput
              ref={inputRef}
              placeholder="How did it feel? What went well? What to improve?"
              value={text}
              onChangeText={setText}
              style={styles.input}
              multiline
              scrollEnabled
              blurOnSubmit={true}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (text.trim()) save();
                else {
                  inputRef.current?.blur();
                  Keyboard.dismiss();
                }
              }}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.primaryBtn, { opacity: text.trim() && !saving ? 1 : 0.5 }]}
              onPress={save}
              disabled={!text.trim() || saving}
            >
              <Text style={styles.primaryBtnText}>{saving ? "Saving…" : "Save"}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f7f8fa" },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 18, fontWeight: "800" },
  back: { color: "#6b7280", fontWeight: "700" },

  subtle: { color: "#6b7280", fontSize: 12, marginHorizontal: 16, marginBottom: 8 },

  card: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
    gap: 6,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entryDate: { color: "#6b7280", fontSize: 12 },
  entryText: { fontSize: 16 },

  composerWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: "rgba(247,248,250,0.98)",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  input: {
    flex: 1,
    height: 120,   // was 110 → lifted a bit higher
    borderWidth: 1,
    borderColor: "#e6e7ea",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: "#fff",
  },

  primaryBtn: {
    backgroundColor: "#FC4C02",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
});
