import "server-only";
export interface TTSProvider {
  speak(text: string, role: "Pacient" | "Voxa"): Promise<Uint8Array>;
}
export const ttsConfigured = () =>
  !!(
    process.env.ELEVENLABS_API_KEY &&
    process.env.ELEVENLABS_VOXA_VOICE_ID &&
    process.env.ELEVENLABS_PATIENT_VOICE_ID
  );
export class ElevenLabsProvider implements TTSProvider {
  async speak(text: string, role: "Pacient" | "Voxa") {
    if (!ttsConfigured()) throw new Error("Audio în așteptarea configurării.");
    const voice =
      role === "Pacient"
        ? process.env.ELEVENLABS_PATIENT_VOICE_ID
        : process.env.ELEVENLABS_VOXA_VOICE_ID;
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice!)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          language_code: "ro",
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!response.ok) throw new Error(`ElevenLabs: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
