import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import fetch from 'node-fetch';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  console.log('🟢 New ConversationRelay WebSocket connected');

  const url = new URL(`http://localhost?${req.url.split('?')[1]}`);
  const recordId = url.searchParams.get('recordId') || null;

  let callSid = '';
  let callerNumber = '';
  let fullTranscript = '';
  let aiSummary = '';
  const chatHistory = [
    {
      role: 'system',
      content: `
You are an experienced SDR at Twilio. You speak clearly and confidently, and sound human.

You're casually smart, not robotic. You're here to help, ask helpful questions, answer confidently, and book a quick meeting if there's interest. Be concise (1-2 sentences). Use natural pauses. Avoid long monologues.

You know Twilio's product line well: SMS, Voice, Flex, Studio, Segment, Email, Auth, and Messaging APIs. You also understand the kinds of pain points Twilio solves for Ops, Sales, and Engineering leaders.

Do not say you're an AI. Do not sound scripted. Always offer to book a follow-up if the conversation is going well.
      `.trim(),
    },
  ];

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'setup') {
        callSid = data.callSid;
        callerNumber = data.from;
        console.log(`🔗 Call SID: ${callSid}`);
      }

      if (data.type === 'prompt') {
        const prompt = data.voicePrompt;
        fullTranscript += `\n${prompt}`;
        console.log('🗣️ Caller:', prompt);

        chatHistory.push({ role: 'user', content: prompt });

        const stream = await openai.chat.completions.create({
          model: 'gpt-4-turbo',
          stream: true,
          messages: chatHistory,
        });

        let reply = '';

        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content;
          if (!token) continue;

          reply += token;

          ws.send(
            JSON.stringify({
              type: 'text',
              token,
              last: false,
            })
          );
        }

        ws.send(
          JSON.stringify({
            type: 'text',
            token: '',
            last: true,
          })
        );

        aiSummary = reply;
        chatHistory.push({ role: 'assistant', content: reply });

        if (/schedule|book|meeting|calendar|demo|call/i.test(prompt + reply)) {
          console.log('📆 Scheduling intent detected. Sending handoff...');

          ws.send(
            JSON.stringify({
              type: 'text',
              token: "Here’s a link to grab time with me: https://calendly.com/your-link/15min — feel free to pick a time that works best.",
              last: true,
            })
          );

          setTimeout(async () => {
            if (recordId) {
              await fetch('https://voice-agent-inky.vercel.app/api/log-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recordId,
                  callSid,
                  from: callerNumber,
                  timestamp: new Date().toISOString(),
                  transcript: fullTranscript,
                  notes: aiSummary,
                  handoffReason: 'Ready to book',
                }),
              });
              console.log('✅ Call data logged to Airtable');
            }

            ws.send(
              JSON.stringify({
                type: 'end',
                handoffData: JSON.stringify({
                  reasonCode: 'sdr-handoff',
                  reason: 'Interested in booking',
                }),
              })
            );
          }, 3000);
        }
      }
    } catch (err) {
      console.error('❌ WebSocket error:', err.message);
    }
  });

  ws.on('close', () => console.log('❌ WebSocket closed'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Relay server listening on port ${PORT}`);
});


