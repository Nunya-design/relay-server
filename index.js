import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

wss.on('connection', (ws) => {
  console.log('📞 New media stream connection');

  ws.on('message', async (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.event === 'start') {
      console.log('🔊 Media stream started');
    }

    if (data.event === 'media') {
      console.log('🎙️ Received audio packet (placeholder)');
      // TODO: Decode audio and transcribe with Whisper here
    }

    if (data.event === 'stop') {
      console.log('🛑 Media stream ended');

      // For now, simulate a generic SDR response
      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful SDR working for Twilio. Keep responses concise and friendly.' },
          { role: 'user', content: 'What can Twilio help me with?' }
        ]
      });

      console.log('🤖 AI Response:', aiResponse.choices[0].message.content);
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket connection closed');
  });
});


  ws.on('close', () => {
    console.log('❌ WebSocket connection closed');
  });
});
