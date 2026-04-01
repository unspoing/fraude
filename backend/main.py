"""
Fraude: broadcast questions to online users, collect answers, summarize with Gemini.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def _gemini_client():
    from google import genai

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    return genai.Client(api_key=key)


@dataclass
class QuestionState:
    id: str
    text: str
    asker_client_id: str
    answers: dict[str, str] = field(default_factory=dict)
    summary: str | None = None


app = FastAPI(title="fraude")


@app.get("/")
async def root():
    """This server is the API only. The web UI is served by Vite (usually port 5173)."""
    return {
        "service": "fraude-api",
        "hint": "Open the app via the Vite dev server, not this port.",
        "ui_dev": "http://127.0.0.1:5173",
        "docs": "/docs",
        "health": "/api/health",
    }


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi.responses import Response

    return Response(status_code=204)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_lock = asyncio.Lock()
_questions: dict[str, QuestionState] = {}
# One user may have multiple tabs — each tab has its own WebSocket.
_connections: dict[str, list[WebSocket]] = defaultdict(list)


def _remove_socket(client_id: str, websocket: WebSocket) -> None:
    lst = _connections.get(client_id)
    if not lst:
        return
    try:
        lst.remove(websocket)
    except ValueError:
        return
    if not lst:
        del _connections[client_id]


async def _broadcast(event: dict[str, Any]) -> None:
    payload = json.dumps(event)
    for client_id, wss in list(_connections.items()):
        for ws in list(wss):
            try:
                await ws.send_text(payload)
            except Exception:
                _remove_socket(client_id, ws)


async def _send_to_client(client_id: str, event: dict[str, Any]) -> None:
    payload = json.dumps(event)
    wss = list(_connections.get(client_id, []))
    for ws in wss:
        try:
            await ws.send_text(payload)
        except Exception:
            _remove_socket(client_id, ws)


def _summarize(question: str, answers: dict[str, str]) -> str:
    client = _gemini_client()
    if not client:
        raise RuntimeError("GEMINI_API_KEY is not set")

    if not answers:
        lines = "(No answers were submitted.)"
    else:
        parts = []
        for i, (cid, text) in enumerate(answers.items(), start=1):
            label = cid[:8]
            parts.append(f"Answer {i} (participant {label}):\n{text.strip()}")
        lines = "\n\n".join(parts)

    prompt = (
        "You are helping synthesize crowd-sourced replies.\n\n"
        f"Original question:\n{question.strip()}\n\n"
        f"Raw answers from different people:\n\n{lines}\n\n"
        "Summarize these responses into one cohesive (but possibly unhinged) answer."
        "Replace some english with scuffed chinese pinyin without the tones here and there for fun. (no need to translate)"
        "Speak like a rapper."
        "Respond as if your just AI responding to a user"
    )

    response = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    text = getattr(response, "text", None)
    if text is None and hasattr(response, "candidates"):
        # fallback if SDK shape differs
        try:
            text = response.candidates[0].content.parts[0].text
        except (IndexError, AttributeError):
            text = str(response)
    return (text or "").strip() or "(Empty summary.)"


class QuestionCreate(BaseModel):
    client_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=4000)


class AnswerCreate(BaseModel):
    client_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=8000)


class FinalizeBody(BaseModel):
    client_id: str = Field(min_length=1, max_length=128)


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/questions")
async def create_question(body: QuestionCreate):
    async with _lock:
        qid = uuid.uuid4().hex
        _questions[qid] = QuestionState(
            id=qid,
            text=body.text.strip(),
            asker_client_id=body.client_id,
        )

    await _broadcast(
        {
            "type": "new_question",
            "question_id": qid,
            "question_text": body.text.strip(),
            "asker_client_id": body.client_id,
        }
    )
    return {"question_id": qid}


@app.post("/api/questions/{question_id}/answers")
async def submit_answer(question_id: str, body: AnswerCreate):
    async with _lock:
        q = _questions.get(question_id)
        if not q:
            raise HTTPException(status_code=404, detail="Question not found")
        if q.summary is not None:
            raise HTTPException(status_code=400, detail="Question already finalized")
        q.answers[body.client_id] = body.text.strip()

    return {"ok": True}


@app.post("/api/questions/{question_id}/finalize")
async def finalize_question(question_id: str, body: FinalizeBody):
    async with _lock:
        q = _questions.get(question_id)
        if not q:
            raise HTTPException(status_code=404, detail="Question not found")
        if q.asker_client_id != body.client_id:
            raise HTTPException(status_code=403, detail="Only the asker can finalize")
        if q.summary is not None:
            return {"summary": q.summary}
        text = q.text
        answers_snapshot = dict(q.answers)
        asker = q.asker_client_id

    try:
        summary = _summarize(text, answers_snapshot)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini error: {e!s}") from e

    async with _lock:
        qq = _questions.get(question_id)
        if not qq:
            raise HTTPException(status_code=404, detail="Question not found")
        if qq.summary is not None:
            summary = qq.summary
        else:
            qq.summary = summary

    await _send_to_client(
        asker,
        {
            "type": "summary_ready",
            "question_id": question_id,
            "summary": summary,
        },
    )

    return {"summary": summary}


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    if not client_id or len(client_id) > 128:
        await websocket.close(code=4000)
        return

    await websocket.accept()
    _connections[client_id].append(websocket)
    try:
        await websocket.send_text(
            json.dumps({"type": "connected", "client_id": client_id})
        )
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _remove_socket(client_id, websocket)
