# Twilio Conversation Relay Server (AI Agent)

This server receives real-time audio via WebSocket from Twilio's Conversation Relay and responds with OpenAI-powered messages.

## Setup

1. Clone this repo and rename `.env.example` to `.env`
2. Add your OpenAI API key
3. Deploy to Render.com or Fly.io, or run locally:

```bash
npm install
npm start
```

## Usage

- WebSocket runs on `ws://<your-server>:8080`
- Plug this into your Twilio `<Conversation>` mediaStream `url`

## TODO

- Add Whisper transcription
- Add real-time audio streaming back (TTS)