import { useState } from "react";
import "./fraude.css";

export default function App() {
    const [question, setQuestion] = useState("");
    const [messages, setMessages] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleAsk = async () => {
        // return if no question 
        if (!question.trim() || isSubmitting) return;

        // store current question and id
        const currentQuestion = question;
        const messageId = crypto.randomUUID();

        // add question to list
        setMessages((m) => [
            ...m,
            { id: messageId, question: currentQuestion, answer: null }
        ]);

        setQuestion("");
        setIsSubmitting(true);

        // wait 10 secs then answer = question
        await new Promise((resolve) => setTimeout(resolve, 10000));
        setMessages((msgs) =>
            msgs.map((msg) =>
                msg.id === messageId
                    ? { ...msg, answer: currentQuestion }
                    : msg
            )
        );
        setIsSubmitting(false);
    };

    return (
        <div className="fraude-root">
            <header className="fraude-topbar">fraude</header>

            <div className="fraude-main">
                <aside className="fraude-left">
                    <label className="fraude-label">question? o-o</label>

                    <textarea
                        className="fraude-textarea"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="what da question"
                        disabled={isSubmitting}
                    />

                    <button
                        className="fraude-button"
                        onClick={handleAsk}
                        disabled={isSubmitting || !question.trim()}
                    >
                        {isSubmitting ? "pondering..." : "ponder"}
                    </button>
                </aside>

                <div className="fraude-divider" />

                <section className="fraude-right">
                    {messages.length === 0 ? (
                        <div className="fraude-card">
                            <span className="fraude-waiting">cue and ayy</span>
                        </div>
                    ) : (
                        messages.map((msg) => (
                            <div key={msg.id} className="fraude-card">
                                <div className="fraude-card-question">q: {msg.question}</div>
                                <div className="fraude-card-answer">
                                    {msg.answer === null ? (
                                        <span className="fraude-waiting">thinking real hard...</span>
                                    ) : msg.answer === "error :(" ? (
                                        <span className="fraude-error">u ass(</span>
                                    ) : (
                                        <span>a: {msg.answer}</span>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </section>
            </div>
        </div>
    );
}