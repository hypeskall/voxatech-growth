"use client";
import { useRef, useState } from "react";
import { Play, Pause, Phone, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";
export function DemoPlayer({
  token,
  company,
  turns,
  audio,
  status,
}: {
  token: string;
  company: string;
  turns: { role: string; text: string }[];
  audio: string[];
  status: string;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const player = useRef<HTMLAudioElement>(null);
  return (
    <div className="panel">
      <div className="demo-player">
        <span className="badge purple">Simulare demonstrativă VoxaTech</span>
        <h1 style={{ marginTop: 22, fontSize: 28 }}>{company}</h1>
        <p className="muted" style={{ marginTop: 10 }}>
          Cum ar putea suna următorul apel la recepție.
        </p>
        <div className="waveform" aria-hidden="true">
          {Array.from({ length: 33 }, (_, i) => (
            <i
              key={i}
              style={{
                height: 12 + Math.abs(Math.sin(i * 1.4)) * 42,
                opacity: playing ? 1 : 0.45,
              }}
            />
          ))}
        </div>
        {audio.length > 0 ? (
          <>
            <p className="muted">
              {done
                ? "Simulare încheiată"
                : turns[index]?.role === "Voxa"
                  ? "Voxa, recepționerul AI"
                  : "Pacient"}
            </p>
            <audio
              ref={player}
              className="audio-player"
              src={audio[index]}
              controls
              onPlay={() => {
                setPlaying(true);
                void fetch(`/api/demo/${token}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ event: "listened" }),
                });
              }}
              onPause={() => setPlaying(false)}
              onError={() =>
                setError("Fișierul audio nu poate fi redat. Reîncarcă pagina.")
              }
              onEnded={() => {
                if (index + 1 < audio.length) {
                  setIndex(index + 1);
                  setTimeout(
                    () =>
                      player.current
                        ?.play()
                        .catch(() =>
                          setError("Apasă redare pentru a continua."),
                        ),
                    150,
                  );
                } else {
                  setPlaying(false);
                  setDone(true);
                }
              }}
            />
            <Button
              className="section-gap"
              onClick={() => {
                if (done) {
                  setDone(false);
                  setIndex(0);
                  setTimeout(() => player.current?.play(), 150);
                } else if (playing) player.current?.pause();
                else
                  void player.current
                    ?.play()
                    .catch(() => setError("Redarea nu este disponibilă."));
              }}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}{" "}
              {playing
                ? "Pauză"
                : done
                  ? "Ascultă din nou"
                  : "Ascultă simularea"}
            </Button>
          </>
        ) : (
          <div className="callout">
            {status === "audio_awaiting_configuration"
              ? "Audio în așteptarea configurării. Scenariul este disponibil mai jos."
              : "Audio se pregătește. Scenariul este disponibil mai jos."}
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <p style={{ fontSize: 12, color: "#71839e", marginTop: 22 }}>
          Conversație fictivă. Nu reprezintă o programare reală.
        </p>
      </div>
      <div className="panel-head">
        <h2>
          <Phone size={16} style={{ display: "inline", marginRight: 8 }} />
          Scenariul conversației
        </h2>
        <CheckCircle2 size={17} style={{ color: "#9c83dc" }} />
      </div>
      <div className="panel-body">
        {turns.map((turn, i) => (
          <div
            key={i}
            className={`message ${turn.role === "Voxa" ? "outbound" : ""}`}
          >
            <div className="message-top">
              {turn.role === "Voxa" ? "Voxa, recepționerul AI" : "Pacient"}
            </div>
            <p className="copy">{turn.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
