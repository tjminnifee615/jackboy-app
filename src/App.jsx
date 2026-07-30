import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle,
  BookOpen,
  Calendar,
  ClipboardList,
  Upload,
  LogOut,
  Send,
  Shield,
  User as UserIcon,
  Trash2,
  Download,
  ChevronLeft,
  ChevronRight,
  Lock,
  Mail,
  Bell,
  BarChart3,
  Presentation,
  ExternalLink,
  Home,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// ---------- Design tokens ----------
const ORANGE = "#E8630A";
const ORANGE_LIGHT = "#FF8A3D";
const BLACK = "#0A0A0A";
const CHARCOAL = "#161616";
const CHARCOAL_2 = "#212121";
const HEADER_FONT = { fontFamily: "'Arial Black', 'Helvetica Neue', Arial, sans-serif" };

// ---------- Backend config ----------
// The "publishable" key below is safe to expose in client code — it's the
// public-facing key, not the service-role secret. Access is enforced by the
// row-level-security policies in the project, not by hiding this string.
const SUPABASE_URL = "https://bvqtuytpuvcllxldqvch.supabase.co";
const SUPABASE_KEY = "sb_publishable_mfbOXVkiicDjbi9XWGfNcw_drIorFtr";
const POLL_MS = 4000;
const MAX_FILE_BYTES = 45 * 1024 * 1024; // Supabase's default per-file cap

// ---------- Minimal REST client (no SDK available in this sandbox) ----------
async function apiFetch(path, { method = "GET", token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token || SUPABASE_KEY}`,
      ...(raw ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j.message || j.error_description || j.msg || j.error || msg;
    } catch (e) {}
    throw new Error(msg);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const authSignUp = (email, password, username, adminCode) =>
  apiFetch("/auth/v1/signup", { method: "POST", body: { email, password, data: { username, admin_code: adminCode } } });

const authSignIn = (email, password) =>
  apiFetch("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });

const authRefresh = (refreshToken) =>
  apiFetch("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } });

const fetchProfile = (uid, token) =>
  apiFetch(`/rest/v1/profiles?id=eq.${uid}&select=username,role`, { token }).then((r) => r?.[0] || null);

const fetchTable = (table, token, query = "") => apiFetch(`/rest/v1/${table}?${query}`, { token }).then((r) => r || []);

const insertRow = (table, token, row) =>
  apiFetch(`/rest/v1/${table}`, { method: "POST", token, body: row, headers: { Prefer: "return=representation" } }).then(
    (r) => r?.[0]
  );

const upsertRow = (table, token, row, onConflict) =>
  apiFetch(`/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    token,
    body: row,
    headers: { Prefer: "return=representation,resolution=merge-duplicates" },
  }).then((r) => r?.[0]);

const deleteRow = (table, token, id) =>
  apiFetch(`/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", token, headers: { Prefer: "return=minimal" } });

const deleteReactionRow = (token, messageId, userId, emoji) =>
  apiFetch(`/rest/v1/message_reactions?message_id=eq.${messageId}&user_id=eq.${userId}&emoji=eq.${encodeURIComponent(emoji)}`, {
    method: "DELETE",
    token,
    headers: { Prefer: "return=minimal" },
  });

const uploadFile = (bucket, path, file, token) =>
  apiFetch(`/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    token,
    raw: true,
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
  }).then(() => path);

const deleteFile = (bucket, path, token) =>
  apiFetch(`/storage/v1/object/${bucket}/${path}`, { method: "DELETE", token, raw: true });

const publicFileUrl = (bucket, path) => `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

const signedFileUrl = async (bucket, path, token, expiresIn = 3600) => {
  const res = await apiFetch(`/storage/v1/object/sign/${bucket}/${path}`, { method: "POST", token, body: { expiresIn } });
  return `${SUPABASE_URL}/storage/v1${res.signedURL}`;
};

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function tryParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function nameFromUrl(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch (e) {
    return "Linked file";
  }
}

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

async function persistSession(refreshToken) {
  try {
    localStorage.setItem("jackboy_session", JSON.stringify({ refreshToken }));
  } catch (e) {}
}

async function loadPersistedSession() {
  try {
    const raw = localStorage.getItem("jackboy_session");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function clearPersistedSession() {
  try {
    localStorage.removeItem("jackboy_session");
  } catch (e) {}
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function todayDateString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getGreeting() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins >= 120 && mins <= 600) return "Good morning";
  if (mins >= 601 && mins <= 780) return "Good afternoon";
  return "Good evening";
}

// ---------- Main App ----------
export default function JackboyApp() {
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState(null); // {accessToken, refreshToken, userId}
  const [profile, setProfile] = useState(null); // {username, role}
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [authInfo, setAuthInfo] = useState("");
  const [tab, setTabRaw] = useState("home");

  const [chatMessages, setChatMessages] = useState([]);
  const [reactions, setReactions] = useState({}); // messageId -> [{id, user_id, username, emoji}]
  const [playbookDocs, setPlaybookDocs] = useState([]);
  const [gameplanWeeks, setGameplanWeeks] = useState([]);
  const [presentationDecks, setPresentationDecks] = useState([]);
  const [todaySchedule, setTodaySchedule] = useState(null);

  const [unread, setUnread] = useState({ chat: false, playbook: false, gameplan: false, presentations: false, home: false });
  const [toast, setToast] = useState(null);

  const seenChatIds = useRef(new Set());
  const seenPlaybookIds = useRef(new Set());
  const seenGameplanIds = useRef(new Set());
  const seenPresentationIds = useRef(new Set());
  const seenScheduleId = useRef(null);
  const seeded = useRef(false);
  const tabRef = useRef("home");
  const sessionRef = useRef(null);
  const notifPermAsked = useRef(false);

  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const setTab = (t) => {
    setTabRaw(t);
    setUnread((u) => ({ ...u, [t]: false }));
  };

  const resetLocalData = () => {
    seeded.current = false;
    seenChatIds.current = new Set();
    seenPlaybookIds.current = new Set();
    seenGameplanIds.current = new Set();
    seenPresentationIds.current = new Set();
    seenScheduleId.current = null;
    setChatMessages([]);
    setReactions({});
    setPlaybookDocs([]);
    setGameplanWeeks([]);
    setPresentationDecks([]);
    setTodaySchedule(null);
    setUnread({ chat: false, playbook: false, gameplan: false, presentations: false, home: false });
  };

  // ---------- auth ----------
  const recordLogin = async (uid, username, token) => {
    try {
      await insertRow("login_events", token, { user_id: uid, username });
    } catch (e) {}
  };

  const establishSession = async (authResponse, { record = true } = {}) => {
    const token = authResponse.access_token;
    const uid = authResponse.user.id;
    const prof = await fetchProfile(uid, token);
    setSession({ accessToken: token, refreshToken: authResponse.refresh_token, userId: uid });
    setProfile(prof);
    persistSession(authResponse.refresh_token);
    if (record) recordLogin(uid, prof?.username || authResponse.user.email, token);
  };

  // try to silently resume a previous session on load, so people don't have to log in every visit
  useEffect(() => {
    (async () => {
      const saved = await loadPersistedSession();
      if (saved?.refreshToken) {
        try {
          const res = await authRefresh(saved.refreshToken);
          await establishSession(res, { record: false });
        } catch (e) {
          await clearPersistedSession();
        }
      }
      setBooted(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (email, password) => {
    setAuthError("");
    setAuthInfo("");
    try {
      const res = await authSignIn(email, password);
      await establishSession(res);
    } catch (e) {
      setAuthError(e.message || "Couldn't log in. Check your email and password.");
    }
  };

  const handleSignup = async (username, email, password, adminCode) => {
    setAuthError("");
    setAuthInfo("");
    if (!username.trim() || !email.trim() || !password) {
      setAuthError("Fill in every field to create an account.");
      return;
    }
    try {
      const res = await authSignUp(email, password, username.trim(), adminCode);
      if (res.access_token) {
        await establishSession(res);
      } else {
        setAuthInfo("Account created — check your email to confirm it, then log in.");
        setAuthMode("login");
      }
    } catch (e) {
      setAuthError(e.message || "Couldn't create that account.");
    }
  };

  const handleLogout = () => {
    setSession(null);
    setProfile(null);
    setTabRaw("home");
    resetLocalData();
    clearPersistedSession();
  };

  // silently refresh the access token before it expires (~1hr lifetime)
  useEffect(() => {
    if (!session) return;
    const id = setInterval(async () => {
      try {
        const res = await authRefresh(sessionRef.current.refreshToken);
        setSession((s) => ({ ...s, accessToken: res.access_token, refreshToken: res.refresh_token }));
        persistSession(res.refresh_token);
      } catch (e) {}
    }, 45 * 60 * 1000);
    return () => clearInterval(id);
  }, [session]);

  // ---------- notifications ----------
  const fireNotification = useCallback((tabId, title, body) => {
    setToast({ tabId, title, body });
    setUnread((u) => (tabRef.current === tabId ? u : { ...u, [tabId]: true }));
    try {
      if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        new Notification(title, { body });
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!session || notifPermAsked.current) return;
    notifPermAsked.current = true;
    try {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch (e) {}
  }, [session]);

  // ---------- row -> app shape mappers ----------
  const mapMessage = (r) => ({ id: r.id, sender: r.sender_username, text: r.text, ts: new Date(r.created_at).getTime() });
  const mapDoc = (r) => ({
    id: r.id,
    filename: r.filename,
    title: r.title,
    kind: r.kind,
    url: r.kind === "link" ? r.url : publicFileUrl("playbook", r.file_path),
    filePath: r.file_path,
    uploadedBy: r.uploaded_by,
    date: new Date(r.created_at).getTime(),
  });
  const mapWeek = (r) => ({
    id: r.id,
    label: r.label,
    filename: r.filename,
    kind: r.kind,
    url: r.kind === "link" ? r.url : publicFileUrl("gameplan", r.file_path),
    filePath: r.file_path,
    uploadedBy: r.uploaded_by,
    date: new Date(r.created_at).getTime(),
  });
  const mapDeck = (r) => ({
    id: r.id,
    filename: r.filename,
    title: r.title,
    kind: r.kind,
    url: r.kind === "link" ? r.url : publicFileUrl("presentations", r.file_path),
    filePath: r.file_path,
    uploadedBy: r.uploaded_by,
    date: new Date(r.created_at).getTime(),
  });
  const mapSchedule = (r) => ({
    id: r.id,
    filename: r.filename,
    kind: r.kind,
    url: r.kind === "link" ? r.url : publicFileUrl("schedule", r.file_path),
    filePath: r.file_path,
    uploadedBy: r.uploaded_by,
    date: new Date(r.created_at).getTime(),
  });

  // ---------- global poller ----------
  useEffect(() => {
    if (!session) return;
    const token = session.accessToken;

    const poll = async () => {
      let chatRows = [],
        playbookRows = [],
        gameplanRows = [],
        presentationRows = [],
        scheduleRows = [],
        reactionRows = [];
      try {
        [chatRows, playbookRows, gameplanRows, presentationRows, scheduleRows, reactionRows] = await Promise.all([
          fetchTable("messages", token, "select=*&order=created_at.asc&limit=300"),
          fetchTable("playbook_docs", token, "select=*&order=created_at.desc"),
          fetchTable("gameplan_weeks", token, "select=*&order=created_at.asc"),
          fetchTable("presentations", token, "select=*&order=created_at.desc"),
          fetchTable("daily_schedule", token, `schedule_date=eq.${todayDateString()}&select=*`),
          fetchTable("message_reactions", token, "select=*"),
        ]);
      } catch (e) {
        return; // network hiccup — try again next tick
      }

      const grouped = {};
      reactionRows.forEach((r) => {
        if (!grouped[r.message_id]) grouped[r.message_id] = [];
        grouped[r.message_id].push(r);
      });
      setReactions(grouped);

      const chat = chatRows.map(mapMessage);
      const playbook = playbookRows.map(mapDoc);
      const gameplan = gameplanRows.map(mapWeek);
      const presentations = presentationRows.map(mapDeck);
      const schedule = scheduleRows[0] ? mapSchedule(scheduleRows[0]) : null;

      if (!seeded.current) {
        chat.forEach((m) => seenChatIds.current.add(m.id));
        playbook.forEach((d) => seenPlaybookIds.current.add(d.id));
        gameplan.forEach((w) => seenGameplanIds.current.add(w.id));
        presentations.forEach((p) => seenPresentationIds.current.add(p.id));
        seenScheduleId.current = schedule?.id || null;
        seeded.current = true;
        setChatMessages(chat);
        setPlaybookDocs(playbook);
        setGameplanWeeks(gameplan);
        setPresentationDecks(presentations);
        setTodaySchedule(schedule);
        return;
      }

      const me = profile?.username;

      const newChat = chat.filter((m) => !seenChatIds.current.has(m.id));
      if (newChat.length) {
        newChat.forEach((m) => seenChatIds.current.add(m.id));
        setChatMessages(chat);
        const fromOthers = newChat.filter((m) => m.sender !== me);
        if (fromOthers.length) fireNotification("chat", fromOthers[fromOthers.length - 1].sender, fromOthers[fromOthers.length - 1].text);
      } else if (chat.length !== chatMessages.length) setChatMessages(chat);

      const newDocs = playbook.filter((d) => !seenPlaybookIds.current.has(d.id));
      if (newDocs.length) {
        newDocs.forEach((d) => seenPlaybookIds.current.add(d.id));
        setPlaybookDocs(playbook);
        const fromOthers = newDocs.filter((d) => d.uploadedBy !== me);
        if (fromOthers.length)
          fireNotification("playbook", "New playbook file", `${fromOthers[fromOthers.length - 1].uploadedBy} uploaded ${fromOthers[fromOthers.length - 1].filename}`);
      } else if (playbook.length !== playbookDocs.length) setPlaybookDocs(playbook);

      const newWeeks = gameplan.filter((w) => !seenGameplanIds.current.has(w.id));
      if (newWeeks.length) {
        newWeeks.forEach((w) => seenGameplanIds.current.add(w.id));
        setGameplanWeeks(gameplan);
        const fromOthers = newWeeks.filter((w) => w.uploadedBy !== me);
        if (fromOthers.length) fireNotification("gameplan", "New game plan posted", fromOthers[fromOthers.length - 1].label);
      } else if (gameplan.length !== gameplanWeeks.length) setGameplanWeeks(gameplan);

      const newDecks = presentations.filter((p) => !seenPresentationIds.current.has(p.id));
      if (newDecks.length) {
        newDecks.forEach((p) => seenPresentationIds.current.add(p.id));
        setPresentationDecks(presentations);
        const fromOthers = newDecks.filter((p) => p.uploadedBy !== me);
        if (fromOthers.length)
          fireNotification("presentations", "New presentation posted", `${fromOthers[fromOthers.length - 1].uploadedBy} uploaded ${fromOthers[fromOthers.length - 1].filename}`);
      } else if (presentations.length !== presentationDecks.length) setPresentationDecks(presentations);

      if (schedule?.id !== seenScheduleId.current) {
        const isNew = schedule && schedule.id !== seenScheduleId.current;
        seenScheduleId.current = schedule?.id || null;
        setTodaySchedule(schedule);
        if (isNew && schedule.uploadedBy !== me) {
          fireNotification("home", "Today's schedule is up", schedule.filename);
        }
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, fireNotification]);

  // ---------- actions ----------
  const toggleReaction = async (messageId, emoji) => {
    const token = sessionRef.current.accessToken;
    const uid = sessionRef.current.userId;
    const mine = (reactions[messageId] || []).find((r) => r.user_id === uid);

    // optimistic local update
    setReactions((prev) => {
      const list = (prev[messageId] || []).filter((r) => r.user_id !== uid);
      if (!mine || mine.emoji !== emoji) list.push({ id: `pending-${Date.now()}`, message_id: messageId, user_id: uid, username: profile.username, emoji });
      return { ...prev, [messageId]: list };
    });

    try {
      if (mine) await deleteReactionRow(token, messageId, uid, mine.emoji);
      if (!mine || mine.emoji !== emoji) {
        await insertRow("message_reactions", token, { message_id: messageId, user_id: uid, username: profile.username, emoji });
      }
    } catch (e) {}
  };

  const sendChatMessage = async (text) => {
    if (!text.trim()) return;
    const token = sessionRef.current.accessToken;
    const row = await insertRow("messages", token, {
      sender_id: sessionRef.current.userId,
      sender_username: profile.username,
      text: text.trim(),
    });
    const mapped = mapMessage(row);
    seenChatIds.current.add(mapped.id);
    setChatMessages((prev) => [...prev, mapped]);
  };

  const uploadPlaybookDoc = async (file, title) => {
    if (file.size > MAX_FILE_BYTES) return { error: "That file is too large (max ~45MB)." };
    const token = sessionRef.current.accessToken;
    try {
      const path = `${Date.now()}_${sanitizeFilename(file.name)}`;
      await uploadFile("playbook", path, file, token);
      const row = await insertRow("playbook_docs", token, { filename: file.name, title: title || null, file_path: path, kind: "file", uploaded_by: profile.username });
      const mapped = mapDoc(row);
      seenPlaybookIds.current.add(mapped.id);
      setPlaybookDocs((prev) => [mapped, ...prev]);
      return null;
    } catch (e) {
      return { error: e.message || "Upload failed." };
    }
  };

  const addPlaybookLink = async (url, name, title) => {
    const token = sessionRef.current.accessToken;
    const row = await insertRow("playbook_docs", token, { filename: name || nameFromUrl(url), title: title || null, url, kind: "link", uploaded_by: profile.username });
    const mapped = mapDoc(row);
    seenPlaybookIds.current.add(mapped.id);
    setPlaybookDocs((prev) => [mapped, ...prev]);
  };

  const removePlaybookDoc = async (id) => {
    const token = sessionRef.current.accessToken;
    const doc = playbookDocs.find((d) => d.id === id);
    setPlaybookDocs((prev) => prev.filter((d) => d.id !== id));
    if (doc?.kind === "file" && doc.filePath) {
      try {
        await deleteFile("playbook", doc.filePath, token);
      } catch (e) {}
    }
    await deleteRow("playbook_docs", token, id);
  };

  const uploadGameplanWeek = async (label, file) => {
    if (file.size > MAX_FILE_BYTES) return { error: "That file is too large (max ~45MB)." };
    const token = sessionRef.current.accessToken;
    try {
      const path = `${Date.now()}_${sanitizeFilename(file.name)}`;
      await uploadFile("gameplan", path, file, token);
      const row = await insertRow("gameplan_weeks", token, { label, filename: file.name, file_path: path, kind: "file", uploaded_by: profile.username });
      const mapped = mapWeek(row);
      seenGameplanIds.current.add(mapped.id);
      setGameplanWeeks((prev) => [...prev, mapped]);
      return null;
    } catch (e) {
      return { error: e.message || "Upload failed." };
    }
  };

  const addGameplanLink = async (label, url, name) => {
    const token = sessionRef.current.accessToken;
    const row = await insertRow("gameplan_weeks", token, { label, filename: name || nameFromUrl(url), url, kind: "link", uploaded_by: profile.username });
    const mapped = mapWeek(row);
    seenGameplanIds.current.add(mapped.id);
    setGameplanWeeks((prev) => [...prev, mapped]);
  };

  const uploadPresentationDeck = async (file, title) => {
    if (file.size > MAX_FILE_BYTES) return { error: "That file is too large (max ~45MB)." };
    const token = sessionRef.current.accessToken;
    try {
      const path = `${Date.now()}_${sanitizeFilename(file.name)}`;
      await uploadFile("presentations", path, file, token);
      const row = await insertRow("presentations", token, { filename: file.name, title: title || null, file_path: path, kind: "file", uploaded_by: profile.username });
      const mapped = mapDeck(row);
      seenPresentationIds.current.add(mapped.id);
      setPresentationDecks((prev) => [mapped, ...prev]);
      return null;
    } catch (e) {
      return { error: e.message || "Upload failed." };
    }
  };

  const addPresentationLink = async (url, name, title) => {
    const token = sessionRef.current.accessToken;
    const row = await insertRow("presentations", token, { filename: name || nameFromUrl(url), title: title || null, url, kind: "link", uploaded_by: profile.username });
    const mapped = mapDeck(row);
    seenPresentationIds.current.add(mapped.id);
    setPresentationDecks((prev) => [mapped, ...prev]);
  };

  const removePresentationDeck = async (id) => {
    const token = sessionRef.current.accessToken;
    const deck = presentationDecks.find((d) => d.id === id);
    setPresentationDecks((prev) => prev.filter((d) => d.id !== id));
    if (deck?.kind === "file" && deck.filePath) {
      try {
        await deleteFile("presentations", deck.filePath, token);
      } catch (e) {}
    }
    await deleteRow("presentations", token, id);
  };

  const uploadTodaySchedule = async (file) => {
    if (file.size > MAX_FILE_BYTES) return { error: "That file is too large (max ~45MB)." };
    const token = sessionRef.current.accessToken;
    try {
      const path = `${todayDateString()}_${Date.now()}_${sanitizeFilename(file.name)}`;
      await uploadFile("schedule", path, file, token);
      const row = await upsertRow(
        "daily_schedule",
        token,
        { schedule_date: todayDateString(), filename: file.name, file_path: path, url: null, kind: "file", uploaded_by: profile.username },
        "schedule_date"
      );
      const mapped = mapSchedule(row);
      seenScheduleId.current = mapped.id;
      setTodaySchedule(mapped);
      return null;
    } catch (e) {
      return { error: e.message || "Upload failed." };
    }
  };

  const addTodayScheduleLink = async (url, name) => {
    const token = sessionRef.current.accessToken;
    const row = await upsertRow(
      "daily_schedule",
      token,
      { schedule_date: todayDateString(), filename: name || nameFromUrl(url), file_path: null, url, kind: "link", uploaded_by: profile.username },
      "schedule_date"
    );
    const mapped = mapSchedule(row);
    seenScheduleId.current = mapped.id;
    setTodaySchedule(mapped);
  };

  const removeTodaySchedule = async () => {
    if (!todaySchedule) return;
    const token = sessionRef.current.accessToken;
    const doc = todaySchedule;
    seenScheduleId.current = null;
    setTodaySchedule(null);
    if (doc.kind === "file" && doc.filePath) {
      try {
        await deleteFile("schedule", doc.filePath, token);
      } catch (e) {}
    }
    await deleteRow("daily_schedule", token, doc.id);
  };

  if (!booted) {
    return (
      <div style={{ background: BLACK }} className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse" style={{ color: ORANGE, ...HEADER_FONT }}>
          JACKBOY
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        onLogin={handleLogin}
        onSignup={handleSignup}
        error={authError}
        info={authInfo}
      />
    );
  }

  if (!profile) {
    return (
      <div style={{ background: BLACK }} className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse" style={{ color: ORANGE, ...HEADER_FONT }}>
          JACKBOY
        </div>
      </div>
    );
  }

  const user = { username: profile.username, role: profile.role };

  return (
    <div style={{ background: "#F5F5F3" }} className="min-h-screen flex flex-col items-center">
      <div className="w-full max-w-md flex flex-col min-h-screen bg-white shadow-xl relative overflow-hidden">
        <TopBar user={user} onLogout={handleLogout} />
        <Toast toast={toast} onTap={(tabId) => { setTab(tabId); setToast(null); }} />
        <div className="flex-1 overflow-y-auto pb-20" style={{ background: "#F5F5F3" }}>
          {tab === "home" && (
            <HomeTab
              user={user}
              schedule={todaySchedule}
              onUpload={uploadTodaySchedule}
              onAddLink={addTodayScheduleLink}
              onRemove={removeTodaySchedule}
            />
          )}
          {tab === "chat" && (
            <ChatTab user={user} messages={chatMessages} onSend={sendChatMessage} reactions={reactions} onReact={toggleReaction} />
          )}
          {tab === "playbook" && (
            <PlaybookTab user={user} docs={playbookDocs} onUpload={uploadPlaybookDoc} onAddLink={addPlaybookLink} onRemove={removePlaybookDoc} />
          )}
          {tab === "class" && <ClassTab user={user} session={sessionRef.current} />}
          {tab === "gameplan" && (
            <GamePlanTab user={user} weeks={gameplanWeeks} onUpload={uploadGameplanWeek} onAddLink={addGameplanLink} />
          )}
          {tab === "presentations" && (
            <PresentationsTab user={user} decks={presentationDecks} onUpload={uploadPresentationDeck} onAddLink={addPresentationLink} onRemove={removePresentationDeck} />
          )}
          {tab === "stats" && user.role === "admin" && <StatsTab session={sessionRef.current} />}
        </div>
        <BottomNav tab={tab} setTab={setTab} unread={unread} isAdmin={user.role === "admin"} />
      </div>
    </div>
  );
}

// ---------- Toast ----------
function Toast({ toast, onTap }) {
  if (!toast) return null;
  return (
    <button
      onClick={() => onTap(toast.tabId)}
      style={{ background: BLACK, borderLeft: `4px solid ${ORANGE}` }}
      className="absolute top-14 left-2 right-2 z-40 rounded-lg px-3 py-2.5 flex items-start gap-2 shadow-lg text-left"
    >
      <Bell size={16} color={ORANGE} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-white text-sm font-semibold truncate">{toast.title}</p>
        <p className="text-neutral-400 text-xs truncate">{toast.body}</p>
      </div>
    </button>
  );
}

// ---------- Auth ----------
function AuthScreen({ mode, setMode, onLogin, onSignup, error, info }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") await onLogin(email, password);
      else await onSignup(username, email, password, adminCode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: BLACK }} className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div style={{ color: ORANGE, letterSpacing: "0.08em", ...HEADER_FONT }} className="text-4xl mb-1">
            JACKBOY
          </div>
          <div style={{ background: ORANGE, height: 3, width: 56 }} className="mx-auto rounded-full" />
          <p className="text-neutral-400 text-sm mt-3 tracking-wide">TEAM HQ</p>
        </div>

        <form
          onSubmit={submit}
          style={{ background: CHARCOAL, border: `1px solid ${CHARCOAL_2}` }}
          className="rounded-2xl p-6 flex flex-col gap-4"
        >
          <div className="flex rounded-lg overflow-hidden mb-1" style={{ background: CHARCOAL_2 }}>
            <button
              type="button"
              onClick={() => setMode("login")}
              className="flex-1 py-2 text-sm font-semibold tracking-wide"
              style={{ background: mode === "login" ? ORANGE : "transparent", color: mode === "login" ? BLACK : "#999" }}
            >
              LOG IN
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className="flex-1 py-2 text-sm font-semibold tracking-wide"
              style={{ background: mode === "signup" ? ORANGE : "transparent", color: mode === "signup" ? BLACK : "#999" }}
            >
              SIGN UP
            </button>
          </div>

          {mode === "signup" && (
            <Field icon={<UserIcon size={16} />} placeholder="Username" value={username} onChange={setUsername} />
          )}

          <Field icon={<Mail size={16} />} placeholder="Email" value={email} onChange={setEmail} type="email" />

          <Field icon={<Lock size={16} />} placeholder="Password" value={password} onChange={setPassword} type="password" />

          {mode === "signup" && (
            <Field icon={<Shield size={16} />} placeholder="Admin code (optional)" value={adminCode} onChange={setAdminCode} />
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}
          {info && <p className="text-emerald-400 text-xs">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            style={{ background: ORANGE, color: BLACK }}
            className="rounded-lg py-3 font-bold tracking-wide mt-1 active:opacity-80 disabled:opacity-60"
          >
            {busy ? "Please wait..." : mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}
          </button>

          <button
            type="button"
            onClick={async () => {
              setTestResult("Testing connection...");
              try {
                const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_KEY } });
                setTestResult(res.ok ? `Connection OK (status ${res.status})` : `Reached Supabase but got status ${res.status}`);
              } catch (e) {
                setTestResult(`Connection test failed: ${e.message}`);
              }
            }}
            className="text-neutral-500 text-xs underline mt-1"
          >
            Test connection to Supabase
          </button>
          {testResult && <p className="text-neutral-300 text-xs">{testResult}</p>}
        </form>
        <p className="text-neutral-600 text-xs text-center mt-4">
          Team admins: use your admin code when signing up to get admin access.
        </p>
      </div>
    </div>
  );
}

function Field({ icon, placeholder, value, onChange, type = "text" }) {
  return (
    <div style={{ background: CHARCOAL_2 }} className="flex items-center gap-2 rounded-lg px-3 py-2.5 focus-within:ring-1">
      <span className="text-neutral-500">{icon}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none text-white text-sm w-full placeholder-neutral-500"
      />
    </div>
  );
}

// ---------- Top bar ----------
function TopBar({ user, onLogout }) {
  return (
    <div style={{ background: BLACK }} className="flex items-center justify-between px-4 py-3 sticky top-0 z-20">
      <div style={{ color: ORANGE, ...HEADER_FONT }} className="text-xl tracking-wide">
        JACKBOY
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div style={{ background: ORANGE_LIGHT, color: BLACK }} className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">
            {initials(user.username)}
          </div>
          {user.role === "admin" && (
            <span style={{ color: ORANGE }} className="text-[10px] font-bold tracking-widest">
              ADMIN
            </span>
          )}
        </div>
        <button onClick={onLogout} className="text-neutral-400 hover:text-white">
          <LogOut size={18} />
        </button>
      </div>
    </div>
  );
}

// ---------- Bottom nav ----------
function BottomNav({ tab, setTab, unread, isAdmin }) {
  const items = [
    { id: "home", label: "Home", icon: Home },
    { id: "chat", label: "Chat", icon: MessageCircle },
    { id: "playbook", label: "Playbook", icon: BookOpen },
    { id: "class", label: "Class", icon: Calendar },
    { id: "gameplan", label: "Game Plan", icon: ClipboardList },
    { id: "presentations", label: "Slides", icon: Presentation },
    ...(isAdmin ? [{ id: "stats", label: "Stats", icon: BarChart3 }] : []),
  ];
  return (
    <div style={{ background: BLACK, borderTop: `2px solid ${ORANGE}` }} className="fixed bottom-0 w-full max-w-md flex justify-around py-2 z-30">
      {items.map(({ id, label, icon: Icon }) => {
        const active = tab === id;
        return (
          <button key={id} onClick={() => setTab(id)} className="flex flex-col items-center gap-0.5 px-2 py-1 relative">
            <span className="relative">
              <Icon size={20} color={active ? ORANGE : "#777"} />
              {unread[id] && <span style={{ background: ORANGE, borderColor: BLACK }} className="absolute -top-1 -right-1.5 w-2.5 h-2.5 rounded-full border-2" />}
            </span>
            <span className="text-[10px] font-semibold tracking-wide" style={{ color: active ? ORANGE : "#777" }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Home (landing page) ----------
function HomeTab({ user, schedule, onUpload, onAddLink, onRemove }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const greeting = getGreeting();
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const isImage = schedule?.kind === "file" && /\.(png|jpe?g|gif|webp|heic)$/i.test(schedule.filename || "");

  const upload = async (file) => {
    setErr("");
    setBusy(true);
    try {
      const result = await onUpload(file);
      if (result?.error) setErr(result.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-5">
      <div className="mb-5">
        <p style={{ ...HEADER_FONT, color: ORANGE }} className="text-2xl leading-tight tracking-wide">
          {greeting.toUpperCase()}, {user.username.toUpperCase()}
        </p>
        <p className="text-neutral-500 text-sm mt-1">{today}</p>
      </div>

      <SectionHeader title="Today's Schedule" subtitle="Posted by the coaching staff" icon={<Calendar size={18} />} />

      {user.role === "admin" && (
        <UploadOrLink accept="application/pdf,image/*" onFile={upload} onLink={onAddLink} uploadLabel={schedule ? "Replace today's schedule" : "Post today's schedule"} busy={busy} />
      )}
      {err && <p className="text-red-500 text-xs mb-3">{err}</p>}

      {!schedule ? (
        <EmptyState text="No schedule posted for today yet." />
      ) : (
        <div className="bg-white rounded-xl p-3 shadow-sm">
          {isImage && <img src={schedule.url} alt="Today's schedule" className="w-full rounded-lg mb-3" />}
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{schedule.filename}</p>
              <p className="text-[11px] text-neutral-500">
                Posted by {schedule.uploadedBy} at {new Date(schedule.date).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                {schedule.kind === "link" && (
                  <span style={{ color: ORANGE }} className="font-semibold">
                    {" "}· LINK
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <a href={schedule.url} target="_blank" rel="noopener noreferrer" style={{ color: ORANGE }}>
                {schedule.kind === "link" ? <ExternalLink size={18} /> : <Download size={18} />}
              </a>
              {user.role === "admin" && (
                <button onClick={onRemove} className="text-neutral-400">
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Chat ----------
const TAPBACK_EMOJIS = ["❤️", "👍", "👎", "😂", "‼️", "❓"];

function ChatTab({ user, messages, onSend, reactions, onReact }) {
  const [text, setText] = useState("");
  const [pickerFor, setPickerFor] = useState(null);
  const bottomRef = useRef(null);
  const pressTimer = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!text.trim()) return;
    onSend(text);
    setText("");
  };

  const startPress = (id) => {
    pressTimer.current = setTimeout(() => setPickerFor(id), 420);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  const pickEmoji = (messageId, emoji) => {
    onReact(messageId, emoji);
    setPickerFor(null);
  };

  const groupReactions = (messageId) => {
    const list = reactions[messageId] || [];
    const byEmoji = {};
    list.forEach((r) => {
      if (!byEmoji[r.emoji]) byEmoji[r.emoji] = [];
      byEmoji[r.emoji].push(r.username);
    });
    return Object.entries(byEmoji).map(([emoji, users]) => ({ emoji, count: users.length, mine: users.includes(user.username) }));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 flex flex-col gap-4">
        {messages.length === 0 && <p className="text-neutral-400 text-sm text-center mt-10">No messages yet — say something to the team.</p>}
        {messages.map((m) => {
          const own = m.sender === user.username;
          const badges = groupReactions(m.id);
          return (
            <div key={m.id} className={`flex ${own ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[75%] relative">
                {!own && <p className="text-[11px] text-neutral-500 mb-0.5 ml-1">{m.sender}</p>}

                {pickerFor === m.id && (
                  <div
                    style={{ background: BLACK }}
                    className={`absolute -top-11 z-30 flex gap-1 rounded-full px-2 py-1.5 shadow-lg ${own ? "right-0" : "left-0"}`}
                  >
                    {TAPBACK_EMOJIS.map((e) => (
                      <button key={e} onClick={() => pickEmoji(m.id, e)} className="text-lg leading-none px-0.5 active:scale-110">
                        {e}
                      </button>
                    ))}
                  </div>
                )}

                <div
                  onMouseDown={() => startPress(m.id)}
                  onMouseUp={cancelPress}
                  onMouseLeave={cancelPress}
                  onTouchStart={() => startPress(m.id)}
                  onTouchEnd={cancelPress}
                  style={{ background: own ? ORANGE : "white", color: own ? BLACK : "#111" }}
                  className="rounded-2xl px-3 py-2 text-sm shadow-sm select-none"
                >
                  {m.text}
                </div>

                {badges.length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${own ? "justify-end" : "justify-start"}`}>
                    {badges.map((b) => (
                      <button
                        key={b.emoji}
                        onClick={() => onReact(m.id, b.emoji)}
                        style={{ background: b.mine ? ORANGE : "white", borderColor: b.mine ? ORANGE : "#e5e5e5" }}
                        className="text-xs rounded-full border px-2 py-0.5 shadow-sm flex items-center gap-1"
                      >
                        <span>{b.emoji}</span>
                        {b.count > 1 && <span className="text-[10px] text-neutral-600">{b.count}</span>}
                      </button>
                    ))}
                  </div>
                )}

                <p className={`text-[10px] text-neutral-400 mt-0.5 ${own ? "text-right mr-1" : "ml-1"}`}>{formatTime(m.ts)}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {pickerFor && <div className="fixed inset-0 z-20" onClick={() => setPickerFor(null)} />}

      <div className="sticky bottom-16 bg-white border-t border-neutral-200 px-3 py-2 flex items-center gap-2 mt-auto">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message the team..."
          className="flex-1 bg-neutral-100 rounded-full px-4 py-2 text-sm outline-none"
        />
        <button onClick={send} style={{ background: ORANGE }} className="w-9 h-9 rounded-full flex items-center justify-center shrink-0">
          <Send size={16} color={BLACK} />
        </button>
      </div>
    </div>
  );
}

// ---------- Upload or paste-a-link toggle ----------
function UploadOrLink({ accept, onFile, onLink, uploadLabel, busy, titleOptions }) {
  const [mode, setMode] = useState("file");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState(titleOptions?.[0] || "");

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    onFile(file, title);
  };

  const submitLink = () => {
    if (!url.trim()) return;
    onLink(url.trim(), name.trim(), title);
    setUrl("");
    setName("");
  };

  return (
    <div className="mb-4">
      {titleOptions && (
        <select
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-neutral-100 rounded-lg px-3 py-2.5 text-sm outline-none mb-2 appearance-none"
        >
          {titleOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      <div className="flex rounded-lg overflow-hidden mb-2" style={{ background: "#EEE" }}>
        <button type="button" onClick={() => setMode("file")} className="flex-1 py-1.5 text-xs font-semibold tracking-wide" style={{ background: mode === "file" ? ORANGE : "transparent", color: mode === "file" ? BLACK : "#777" }}>
          UPLOAD FILE
        </button>
        <button type="button" onClick={() => setMode("link")} className="flex-1 py-1.5 text-xs font-semibold tracking-wide" style={{ background: mode === "link" ? ORANGE : "transparent", color: mode === "link" ? BLACK : "#777" }}>
          PASTE LINK
        </button>
      </div>

      {mode === "file" ? (
        <label style={{ borderColor: ORANGE }} className="border-2 border-dashed rounded-xl flex items-center justify-center gap-2 py-4 cursor-pointer text-sm font-semibold">
          <Upload size={16} color={ORANGE} />
          <span style={{ color: ORANGE }}>{busy ? "Uploading..." : uploadLabel}</span>
          <input type="file" accept={accept} className="hidden" onChange={handleFileChange} disabled={busy} />
        </label>
      ) : (
        <div className="bg-white rounded-xl p-3 shadow-sm flex flex-col gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste Google Drive / Dropbox link" className="w-full bg-neutral-100 rounded-lg px-3 py-2 text-sm outline-none" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name (optional)" className="w-full bg-neutral-100 rounded-lg px-3 py-2 text-sm outline-none" />
          <button type="button" onClick={submitLink} style={{ background: ORANGE, color: BLACK }} className="rounded-lg py-2 text-sm font-bold tracking-wide">
            Add link
          </button>
          <p className="text-[10px] text-neutral-400">Make sure the link is set to "anyone with the link can view" before sharing it here.</p>
        </div>
      )}
    </div>
  );
}

// ---------- Playbook ----------
function PlaybookTab({ user, docs, onUpload, onAddLink, onRemove }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const titleOptions = ["Practice Plan", "Game Plan", "Scouting Report", "Film Study", "Walkthrough", "Team Notes", "Other"];

  const upload = async (file, title) => {
    setErr("");
    setBusy(true);
    try {
      const result = await onUpload(file, title);
      if (result?.error) setErr(result.error);
    } finally {
      setBusy(false);
    }
  };

  const addLink = (url, name, title) => onAddLink(url, name, title);

  return (
    <div className="px-4 py-4">
      <SectionHeader title="Playbook" subtitle="Daily uploads from the coaching staff" icon={<BookOpen size={18} />} />

      {user.role === "admin" && <UploadOrLink accept="application/pdf" onFile={upload} onLink={addLink} uploadLabel="Upload today's PDF" busy={busy} titleOptions={titleOptions} />}
      {err && <p className="text-red-500 text-xs mb-3">{err}</p>}

      {docs.length === 0 && <EmptyState text="No playbook files yet." />}

      <div className="flex flex-col gap-2">
        {docs.map((d) => (
          <div key={d.id} className="bg-white rounded-xl px-3 py-3 flex items-center justify-between shadow-sm">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{d.title || d.filename}</p>
              {d.title && <p className="text-[11px] text-neutral-400 truncate">{d.filename}</p>}
              <p className="text-[11px] text-neutral-500">
                {new Date(d.date).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {d.uploadedBy}
                {d.kind === "link" && (
                  <span style={{ color: ORANGE }} className="font-semibold">
                    {" "}· LINK
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              {d.kind === "link" ? (
                <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: ORANGE }}>
                  <ExternalLink size={18} />
                </a>
              ) : (
                <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: ORANGE }}>
                  <Download size={18} />
                </a>
              )}
              {user.role === "admin" && (
                <button onClick={() => onRemove(d.id)} className="text-neutral-400">
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Class schedule ----------
function ClassTab({ user, session }) {
  const [schedule, setSchedule] = useState(null);
  const [displayUrl, setDisplayUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchTable("class_schedules", session.accessToken, `user_id=eq.${session.userId}&select=*`);
      const row = rows?.[0] || null;
      setSchedule(row);
      if (row) {
        const url = await signedFileUrl("class-schedules", row.file_path, session.accessToken);
        setDisplayUrl(url);
      }
    } catch (e) {
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    if (file.size > MAX_FILE_BYTES) {
      setErr("That image is too large.");
      return;
    }
    setBusy(true);
    try {
      const path = `${session.userId}/${Date.now()}_${sanitizeFilename(file.name)}`;
      await uploadFile("class-schedules", path, file, session.accessToken);
      const row = await upsertRow("class_schedules", session.accessToken, { user_id: session.userId, file_path: path, filename: file.name }, "user_id");
      setSchedule(row);
      const url = await signedFileUrl("class-schedules", path, session.accessToken);
      setDisplayUrl(url);
    } catch (e) {
      setErr(e.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-4">
      <SectionHeader title="Class Schedule" subtitle="Your screenshot, visible only to you" icon={<Calendar size={18} />} />

      {loading ? (
        <p className="text-neutral-400 text-sm">Loading...</p>
      ) : schedule ? (
        <div className="bg-white rounded-xl p-3 shadow-sm">
          {displayUrl && <img src={displayUrl} alt="Class schedule" className="w-full rounded-lg mb-2" />}
          <p className="text-[11px] text-neutral-500 mb-3">Uploaded {new Date(schedule.uploaded_at).toLocaleDateString()}</p>
          <label style={{ borderColor: ORANGE, color: ORANGE }} className="border-2 rounded-lg flex items-center justify-center gap-2 py-2 text-sm font-semibold cursor-pointer">
            <Upload size={14} />
            {busy ? "Uploading..." : "Replace screenshot"}
            <input type="file" accept="image/*" className="hidden" onChange={upload} disabled={busy} />
          </label>
        </div>
      ) : (
        <label style={{ borderColor: ORANGE }} className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 py-10 cursor-pointer">
          <Upload size={22} color={ORANGE} />
          <span style={{ color: ORANGE }} className="text-sm font-semibold">
            {busy ? "Uploading..." : "Upload your class schedule"}
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={upload} disabled={busy} />
        </label>
      )}
      {err && <p className="text-red-500 text-xs mt-2">{err}</p>}
    </div>
  );
}

// ---------- Game Plan ----------
function GamePlanTab({ user, weeks, onUpload, onAddLink }) {
  const [index, setIndex] = useState(weeks.length - 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    setIndex(Math.max(0, weeks.length - 1));
  }, [weeks.length]);

  const upload = async (file) => {
    if (!label.trim()) {
      setErr("Give this week a label first (e.g. Week 1: Aug 25).");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const result = await onUpload(label.trim(), file);
      if (result?.error) setErr(result.error);
      else setLabel("");
    } finally {
      setBusy(false);
    }
  };

  const addLink = (url, name) => {
    if (!label.trim()) {
      setErr("Give this week a label first (e.g. Week 1: Aug 25).");
      return;
    }
    setErr("");
    onAddLink(label.trim(), url, name);
    setLabel("");
  };

  const current = weeks[index];

  return (
    <div className="px-4 py-4">
      <SectionHeader title="Game Plan" subtitle="Week by week" icon={<ClipboardList size={18} />} />

      {user.role === "admin" && (
        <div className="bg-white rounded-xl p-3 shadow-sm mb-4">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Week label (e.g. Week 1: Aug 25)" className="w-full bg-neutral-100 rounded-lg px-3 py-2 text-sm outline-none mb-2" />
          <UploadOrLink accept="application/pdf" onFile={upload} onLink={addLink} uploadLabel="Add this week's PDF" busy={busy} />
          {err && <p className="text-red-500 text-xs -mt-2 mb-2">{err}</p>}
        </div>
      )}

      {weeks.length === 0 ? (
        <EmptyState text="No weeks posted yet." />
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} className="p-2 disabled:opacity-30">
              <ChevronLeft color={ORANGE} />
            </button>
            <div className="text-center">
              <p style={{ ...HEADER_FONT }} className="text-sm tracking-wide">
                {current?.label}
              </p>
              <p className="text-[11px] text-neutral-500">
                {index + 1} of {weeks.length}
              </p>
            </div>
            <button onClick={() => setIndex((i) => Math.min(weeks.length - 1, i + 1))} disabled={index === weeks.length - 1} className="p-2 disabled:opacity-30">
              <ChevronRight color={ORANGE} />
            </button>
          </div>

          {current && (
            <div className="bg-white rounded-xl px-3 py-3 flex items-center justify-between shadow-sm">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{current.filename}</p>
                <p className="text-[11px] text-neutral-500">
                  Posted {new Date(current.date).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {current.uploadedBy}
                  {current.kind === "link" && (
                    <span style={{ color: ORANGE }} className="font-semibold">
                      {" "}· LINK
                    </span>
                  )}
                </p>
              </div>
              <a href={current.url} target="_blank" rel="noopener noreferrer" style={{ color: ORANGE }} className="ml-2 shrink-0">
                {current.kind === "link" ? <ExternalLink size={20} /> : <Download size={20} />}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Presentations ----------
function PresentationsTab({ user, decks, onUpload, onAddLink, onRemove }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const titleOptions = ["Team Meeting", "Film Session", "Scouting Report", "Guest Speaker", "Recruiting", "Banquet", "Other"];

  const upload = async (file, title) => {
    setErr("");
    setBusy(true);
    try {
      const result = await onUpload(file, title);
      if (result?.error) setErr(result.error);
    } finally {
      setBusy(false);
    }
  };

  const addLink = (url, name, title) => onAddLink(url, name, title);

  return (
    <div className="px-4 py-4">
      <SectionHeader title="Presentations" subtitle="Slide decks from the coaching staff, newest first" icon={<Presentation size={18} />} />

      {user.role === "admin" && (
        <UploadOrLink
          accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onFile={upload}
          onLink={addLink}
          uploadLabel="Upload a presentation"
          busy={busy}
          titleOptions={titleOptions}
        />
      )}
      {err && <p className="text-red-500 text-xs mb-3">{err}</p>}

      {decks.length === 0 && <EmptyState text="No presentations posted yet." />}

      <div className="flex flex-col gap-2">
        {decks.map((d) => (
          <div key={d.id} className="bg-white rounded-xl px-3 py-3 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              <div style={{ background: BLACK }} className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0">
                <Presentation size={16} color={ORANGE} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{d.title || d.filename}</p>
                {d.title && <p className="text-[11px] text-neutral-400 truncate">{d.filename}</p>}
                <p className="text-[11px] text-neutral-500">
                  {new Date(d.date).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {d.uploadedBy}
                  {d.kind === "link" && (
                    <span style={{ color: ORANGE }} className="font-semibold">
                      {" "}· LINK
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-2">
              <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ color: ORANGE }}>
                {d.kind === "link" ? <ExternalLink size={18} /> : <Download size={18} />}
              </a>
              {user.role === "admin" && (
                <button onClick={() => onRemove(d.id)} className="text-neutral-400">
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Stats (admin only) ----------
function StatsTab({ session }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchTable("login_events", session.accessToken, "select=*&order=created_at.desc&limit=2000");
      setEvents(rows.map((r) => ({ username: r.username, ts: new Date(r.created_at).getTime() })));
    } catch (e) {
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  const dateKey = (ts) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });

  const byDate = {};
  events.forEach((e) => {
    const k = dateKey(e.ts);
    byDate[k] = (byDate[k] || 0) + 1;
  });
  const chartData = Object.entries(byDate).map(([date, count]) => ({ date, count })).slice(-14);

  const byUser = {};
  events.forEach((e) => {
    byUser[e.username] = (byUser[e.username] || 0) + 1;
  });
  const userTotals = Object.entries(byUser).map(([username, count]) => ({ username, count })).sort((a, b) => b.count - a.count);

  return (
    <div className="px-4 py-4">
      <SectionHeader title="Login Stats" subtitle="Admin only" icon={<BarChart3 size={18} />} />

      {loading && <p className="text-neutral-400 text-sm">Loading...</p>}
      {!loading && events.length === 0 && <EmptyState text="No logins recorded yet." />}

      {!loading && events.length > 0 && (
        <>
          <div className="bg-white rounded-xl p-3 shadow-sm mb-4">
            <p className="text-xs font-semibold text-neutral-500 mb-2 tracking-wide">LOGINS BY DATE (LAST 14 DAYS ACTIVE)</p>
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={ORANGE} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl p-3 shadow-sm">
            <p className="text-xs font-semibold text-neutral-500 mb-3 tracking-wide">TOTAL LOGINS BY USER</p>
            <div className="flex flex-col gap-2">
              {userTotals.map((u) => (
                <div key={u.username} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div style={{ background: ORANGE_LIGHT, color: BLACK }} className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">
                      {initials(u.username)}
                    </div>
                    <span className="text-sm truncate">{u.username}</span>
                  </div>
                  <span style={{ color: ORANGE }} className="text-sm font-bold shrink-0">
                    {u.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Shared bits ----------
function SectionHeader({ title, subtitle, icon }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div style={{ background: BLACK }} className="w-9 h-9 rounded-lg flex items-center justify-center">
        <span style={{ color: ORANGE }}>{icon}</span>
      </div>
      <div>
        <p style={{ ...HEADER_FONT }} className="text-lg leading-tight tracking-wide">
          {title.toUpperCase()}
        </p>
        <p className="text-[11px] text-neutral-500">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="text-center py-10">
      <p className="text-neutral-400 text-sm">{text}</p>
    </div>
  );
}
