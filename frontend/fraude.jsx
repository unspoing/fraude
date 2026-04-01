import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./fraude.css";

/** Works on http:// + LAN IPs; `randomUUID()` throws outside secure contexts (localhost is ok, 172.x is not). */
function newClientId() {
    try {
        if (globalThis.crypto?.randomUUID) {
            return globalThis.crypto.randomUUID();
        }
    } catch {
        /* non-secure context */
    }
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 16; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function getOrCreateClientId() {
    let id = sessionStorage.getItem("fraude_client_id");
    if (!id) {
        id = newClientId();
        sessionStorage.setItem("fraude_client_id", id);
    }
    return id;
}

function SendIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
    );
}

function ThinkingDots() {
    return (
        <div className="fraude-thinking">
            <span /><span /><span />
        </div>
    );
}

// Each message in the chat:
// { id, role: 'user'|'fraude'|'incoming', text, thinking?, responded?, qid?, draft? }

export default function App() {
    const clientId = useMemo(() => getOrCreateClientId(), []);
    const shortId   = clientId.slice(0, 8);
    const initials  = shortId.slice(0, 2).toUpperCase();

    const [wsState, setWsState]     = useState("connecting");
    const [error, setError]         = useState(null);
    const [question, setQuestion]   = useState("");
    const [messages, setMessages]   = useState([]);
    const [threads, setThreads]     = useState([]); // sidebar list
    const [activeThread, setActiveThread] = useState(null);

    const wsRef       = useRef(null);
    const bottomRef   = useRef(null);
    const textareaRef = useRef(null);

    // Auto-scroll to bottom
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Auto-resize textarea
    const handleInput = (e) => {
        setQuestion(e.target.value);
        e.target.style.height = "auto";
        e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
    };

    const handleWsMessage = useCallback((ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }

        if (data.type === "new_question") {
            if (data.asker_client_id === clientId) {
                // Our question was confirmed — mark as thinking (WS may arrive before fetch patches pendingQid)
                setMessages((prev) => prev.map((m) => {
                    if (m.role !== "fraude") return m;
                    const matches =
                        m.pendingQid === data.question_id ||
                        (typeof m.pendingQid === "string" &&
                            m.pendingQid.startsWith("__pending__") &&
                            !m.qid);
                    return matches
                        ? { ...m, thinking: true, pendingQid: undefined, qid: data.question_id }
                        : m;
                }));
                setThreads((t) => [{ qid: data.question_id, text: data.question_text }, ...t]);
            } else {
                // Someone else asked — show as incoming card
                setMessages((prev) => [
                    ...prev,
                    {
                        id: newClientId(),
                        role: "incoming",
                        qid: data.question_id,
                        text: data.question_text,
                        draft: "",
                        responded: false,
                    },
                ]);
            }
        }

        if (data.type === "summary_ready") {
            // Replace thinking bubble with the answer
            setMessages((prev) => prev.map((m) =>
                m.qid === data.question_id
                    ? { ...m, thinking: false, answer: data.summary }
                    : m
            ));
        }
    }, [clientId]);

    useEffect(() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}/ws/${encodeURIComponent(clientId)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen    = () => { setWsState("open"); setError(null); };
        ws.onclose   = () => setWsState("closed");
        ws.onerror   = () => setError("WebSocket error — is the backend running on :8000?");
        ws.onmessage = handleWsMessage;

        const ping = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 25000);

        return () => { clearInterval(ping); ws.close(); };
    }, [clientId, handleWsMessage]);

    const handleAsk = async () => {
        const t = question.trim();
        if (!t) return;
        setError(null);

        // Optimistically add user bubble + a pending fraude bubble
        const tempQid = "__pending__" + newClientId();
        const userMsgId = newClientId();
        const fraudeMsgId = newClientId();

        setMessages((prev) => [
            ...prev,
            { id: userMsgId, role: "user", text: t },
            { id: fraudeMsgId, role: "fraude", thinking: true, pendingQid: tempQid, qid: null, answer: null },
        ]);
        setQuestion("");
        if (textareaRef.current) { textareaRef.current.style.height = "auto"; }

        try {
            const res = await fetch("/api/questions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_id: clientId, text: t }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || res.statusText);
            }
            const data = await res.json();
            // Patch the pending fraude bubble with the real qid
            setMessages((prev) => prev.map((m) =>
                m.pendingQid === tempQid ? { ...m, pendingQid: data.question_id, qid: data.question_id } : m
            ));
        } catch (e) {
            setError(e.message || String(e));
            setMessages((prev) => prev.filter((m) => m.id !== fraudeMsgId));
        }
    };

    const handleFinalize = async (qid) => {
        setError(null);
        try {
            const res = await fetch(`/api/questions/${qid}/finalize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_id: clientId }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body));
            setMessages((prev) => prev.map((m) =>
                m.qid === qid ? { ...m, thinking: false, answer: body.summary } : m
            ));
        } catch (e) {
            setError(e.message || String(e));
        }
    };

    const updateDraft = (msgId, val) => {
        setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, draft: val } : m));
    };

    const submitAnswer = async (msg) => {
        const text = (msg.draft || "").trim();
        if (!text) return;
        setError(null);
        try {
            const res = await fetch(`/api/questions/${msg.qid}/answers`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_id: clientId, text }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || res.statusText);
            }
            setMessages((prev) => prev.map((m) =>
                m.id === msg.id ? { ...m, responded: true } : m
            ));
        } catch (e) {
            setError(e.message || String(e));
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleAsk();
        }
    };

    return (
        <div className="fraude-root">

            {/* ── Sidebar ── */}
            <aside className="fraude-sidebar">
                <div className="fraude-sidebar-logo">fraude</div>

                {threads.length > 0 && (
                    <>
                        <div className="fraude-sidebar-label">recent</div>
                        {threads.map((t) => (
                            <div
                                key={t.qid}
                                className={`fraude-thread-item ${activeThread === t.qid ? "active" : ""}`}
                                onClick={() => setActiveThread(t.qid)}
                            >
                                <span className="fraude-thread-dot" />
                                {t.text.length > 32 ? t.text.slice(0, 32) + "…" : t.text}
                            </div>
                        ))}
                    </>
                )}

                <div className="fraude-sidebar-bottom">
                    <div className="fraude-session-chip">
                        <div className="fraude-avatar">{initials}</div>
                        <div className="fraude-session-info">
                            <div className="fraude-session-name">you</div>
                            <div className="fraude-session-id">{shortId}…</div>
                        </div>
                        <div className={`fraude-ws-badge ws-${wsState}`} title={wsState} />
                    </div>
                </div>
            </aside>

            {/* ── Chat ── */}
            <div className="fraude-chat">
                {error && <div className="fraude-banner">{error}</div>}

                <header className="fraude-chat-header">
                    ask the crowd
                </header>

                {/* Messages */}
                {messages.length === 0 ? (
                    <div className="fraude-empty">
                        <div className="fraude-empty-logo">fraude</div>
                        <div className="fraude-empty-sub">ask something — everyone online gets pinged</div>
                    </div>
                ) : (
                    <div className="fraude-messages">
                        {messages.map((msg) => {

                            /* User bubble */
                            if (msg.role === "user") return (
                                <div key={msg.id} className="fraude-message-row user">
                                    <div className="fraude-message-inner">
                                        <div className="fraude-bubble">{msg.text}</div>
                                    </div>
                                </div>
                            );

                            /* Fraude response bubble */
                            if (msg.role === "fraude") return (
                                <div key={msg.id} className="fraude-message-row fraude">
                                    <div className="fraude-message-inner">
                                        <div className="fraude-msg-avatar">f</div>
                                        <div className="fraude-msg-body">
                                            <div className="fraude-msg-sender">fraude</div>
                                            {msg.thinking && !msg.answer ? (
                                                <>
                                                    <ThinkingDots />
                                                    {msg.qid && (
                                                        <button
                                                            className="fraude-inline-btn"
                                                            style={{ marginTop: 8, alignSelf: "flex-start" }}
                                                            onClick={() => handleFinalize(msg.qid)}
                                                        >
                                                            get gemini's take →
                                                        </button>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="fraude-msg-text">{msg.answer}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );

                            /* Incoming question from another user */
                            if (msg.role === "incoming") return (
                                <div key={msg.id} className="fraude-message-row fraude">
                                    <div className="fraude-message-inner">
                                        <div className="fraude-msg-avatar">?</div>
                                        <div className="fraude-msg-body">
                                            <div className="fraude-incoming-card">
                                                <div className="fraude-incoming-label">someone needs your wisdom</div>
                                                <div className="fraude-incoming-question">{msg.text}</div>
                                                {!msg.responded ? (
                                                    <>
                                                        <textarea
                                                            className="fraude-inline-textarea"
                                                            placeholder="drop your raw take…"
                                                            value={msg.draft || ""}
                                                            onChange={(e) => updateDraft(msg.id, e.target.value)}
                                                        />
                                                        <button
                                                            className="fraude-inline-btn"
                                                            onClick={() => submitAnswer(msg)}
                                                            disabled={!(msg.draft || "").trim()}
                                                        >
                                                            bestow wisdom
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
                                                        wisdom bestowed ✓
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );

                            return null;
                        })}
                        <div ref={bottomRef} />
                    </div>
                )}

                {/* Input bar */}
                <div className="fraude-input-bar">
                    <div className="fraude-input-wrap">
                        <textarea
                            ref={textareaRef}
                            className="fraude-input-field"
                            placeholder="ask the crowd something…"
                            value={question}
                            onChange={handleInput}
                            onKeyDown={handleKeyDown}
                            rows={1}
                        />
                        <div className="fraude-input-actions">
                            <span className="fraude-input-hint">↵ send · shift+↵ newline</span>
                            <button
                                className="fraude-send-btn"
                                onClick={handleAsk}
                                disabled={!question.trim()}
                                title="Send"
                            >
                                <SendIcon />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}