import { useCallback, useEffect, useMemo, useState } from "react";
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

export default function App() {
    const clientId = useMemo(() => getOrCreateClientId(), []);

    const [question, setQuestion] = useState("");
    const [wsState, setWsState] = useState("connecting");
    const [error, setError] = useState(null);

    /** @type {Record<string, { text: string, status: 'open'|'summarized', summary?: string }>} */
    const [myQuestions, setMyQuestions] = useState({});
    /** @type {Record<string, { text: string, askerId: string }>} */
    const [toAnswer, setToAnswer] = useState({});
    const [answerDrafts, setAnswerDrafts] = useState({});

    const handleWsMessage = useCallback((ev) => {
        let data;
        try {
            data = JSON.parse(ev.data);
        } catch {
            return;
        }
        if (data.type === "new_question") {
            if (data.asker_client_id === clientId) {
                setMyQuestions((prev) => ({
                    ...prev,
                    [data.question_id]: { text: data.question_text, status: "open" },
                }));
            } else {
                setToAnswer((prev) => ({
                    ...prev,
                    [data.question_id]: {
                        text: data.question_text,
                        askerId: data.asker_client_id,
                    },
                }));
            }
        }
        if (data.type === "summary_ready") {
            setMyQuestions((prev) => {
                const cur = prev[data.question_id];
                if (!cur) return prev;
                return {
                    ...prev,
                    [data.question_id]: {
                        ...cur,
                        status: "summarized",
                        summary: data.summary,
                    },
                };
            });
        }
    }, [clientId]);

    useEffect(() => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}/ws/${encodeURIComponent(clientId)}`;
        const ws = new WebSocket(url);

        ws.onopen = () => {
            setWsState("open");
            setError(null);
        };
        ws.onclose = () => setWsState("closed");
        ws.onerror = () => setError("WebSocket error — is the API running on :8000?");
        ws.onmessage = handleWsMessage;

        const ping = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send("ping");
            }
        }, 25000);

        return () => {
            clearInterval(ping);
            ws.close();
        };
    }, [clientId, handleWsMessage]);

    const handleAsk = async () => {
        const t = question.trim();
        if (!t) return;
        setError(null);
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
            setMyQuestions((prev) => ({
                ...prev,
                [data.question_id]: { text: t, status: "open" },
            }));
            setQuestion("");
        } catch (e) {
            setError(e.message || String(e));
        }
    };

    const submitAnswer = async (qid) => {
        const text = (answerDrafts[qid] || "").trim();
        if (!text) return;
        setError(null);
        try {
            const res = await fetch(`/api/questions/${qid}/answers`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_id: clientId, text }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || res.statusText);
            }
            setToAnswer((prev) => {
                const next = { ...prev };
                delete next[qid];
                return next;
            });
            setAnswerDrafts((prev) => {
                const next = { ...prev };
                delete next[qid];
                return next;
            });
        } catch (e) {
            setError(e.message || String(e));
        }
    };

    const finalize = async (qid) => {
        setError(null);
        try {
            const res = await fetch(`/api/questions/${qid}/finalize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_id: clientId }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    typeof body.detail === "string"
                        ? body.detail
                        : JSON.stringify(body.detail || body)
                );
            }
            setMyQuestions((prev) => ({
                ...prev,
                [qid]: {
                    ...prev[qid],
                    status: "summarized",
                    summary: body.summary,
                },
            }));
        } catch (e) {
            setError(e.message || String(e));
        }
    };

    const myList = Object.entries(myQuestions).sort(([a], [b]) => a.localeCompare(b));

    return (
        <div className="fraude-root">
            <header className="fraude-topbar">
                <span>fraude</span>
                <span className={`fraude-ws fraude-ws-${wsState}`}>
                    {wsState === "open"
                        ? "live"
                        : wsState === "connecting"
                          ? "connecting…"
                          : "offline"}
                </span>
            </header>

            {error ? <div className="fraude-banner">{error}</div> : null}

            <div className="fraude-main">
                <aside className="fraude-left">
                    <p className="fraude-hint">
                        You are <code className="fraude-code">{clientId.slice(0, 8)}…</code>
                    </p>
                    <label className="fraude-label">your question</label>
                    <textarea
                        className="fraude-textarea"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="ask something — everyone online gets pinged"
                        rows={6}
                    />
                    <button
                        type="button"
                        className="fraude-button"
                        onClick={handleAsk}
                        disabled={!question.trim()}
                    >
                        ask the crowd
                    </button>
                </aside>

                <div className="fraude-divider" />

                <section className="fraude-right">
                    <h2 className="fraude-section-title">your threads</h2>
                    {myList.length === 0 ? (
                        <div className="fraude-card fraude-muted">nothing here yet</div>
                    ) : (
                        myList.map(([qid, q]) => (
                            <div key={qid} className="fraude-card">
                                <div className="fraude-card-question">q: {q.text}</div>
                                {q.status === "open" ? (
                                    <div className="fraude-actions">
                                        <button
                                            type="button"
                                            className="fraude-button fraude-button-secondary"
                                            onClick={() => finalize(qid)}
                                        >
                                            get summary (Gemini)
                                        </button>
                                    </div>
                                ) : (
                                    <div className="fraude-card-answer">
                                        <span className="fraude-label">summary</span>
                                        <p className="fraude-summary">{q.summary}</p>
                                    </div>
                                )}
                            </div>
                        ))
                    )}

                    <h2 className="fraude-section-title">answer others</h2>
                    {Object.keys(toAnswer).length === 0 ? (
                        <div className="fraude-card fraude-muted">no open questions</div>
                    ) : (
                        Object.entries(toAnswer).map(([qid, item]) => (
                            <div key={qid} className="fraude-card fraude-card-incoming">
                                <div className="fraude-card-question">q: {item.text}</div>
                                <textarea
                                    className="fraude-textarea fraude-textarea-sm"
                                    placeholder="your raw take"
                                    value={answerDrafts[qid] || ""}
                                    onChange={(e) =>
                                        setAnswerDrafts((d) => ({
                                            ...d,
                                            [qid]: e.target.value,
                                        }))
                                    }
                                    rows={4}
                                />
                                <button
                                    type="button"
                                    className="fraude-button"
                                    onClick={() => submitAnswer(qid)}
                                    disabled={!(answerDrafts[qid] || "").trim()}
                                >
                                    send answer
                                </button>
                            </div>
                        ))
                    )}
                </section>
            </div>
        </div>
    );
}
