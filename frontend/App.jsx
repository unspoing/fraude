import { useState } from "react";

export default function Fraude() {
  const [text, setText] = useState("");

  const handleAsk = () => {
    console.log(text);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      
      {/* Top bar */}
      <div style={{
        height: 44,
        display: "flex",
        alignItems: "center",
        paddingLeft: 16,
        fontWeight: "bold",
        borderBottom: "1px solid #ccc"
      }}>
        fraude
      </div>

      {/* Main pane */}
      <div style={{ flex: 1, display: "flex" }}>
        
        {/* Left panel */}
        <div style={{
          width: 300,
          display: "flex",
          flexDirection: "column",
          padding: 18,
          boxSizing: "border-box"
        }}>
          
          <label>question? o-o</label>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{
              marginTop: 4,
              marginBottom: 14,
              flex: 1,
              resize: "none"
            }}
          />

          <button onClick={handleAsk}>
            ponder
          </button>
        </div>

        {/* Divider */}
        <div style={{
          width: 2,
          background: "#ccc"
        }} />

        {/* Right side (empty) */}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  );
}