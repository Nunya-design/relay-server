const WebSocket = require('ws');
const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

wss.on('connection', (ws) => {
  console.log('📞 New media stream connection');

  ws.on('message', async (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.event === 'start') {
      console.log('🔊 Media stream started');
    }

    if (data.event === 'media') {
      // In production, you'd decode and process audio here.
      console.log('🎙️ Received audio packet (not processed)');
    }

    if (data.event === 'stop') {
      console.log('🛑 Media stream ended');

      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a helpful SDR for Twilio.' },
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