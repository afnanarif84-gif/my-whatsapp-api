const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { EdgeTTS } = require("node-edge-tts");
const schedule = require("node-schedule");
const moment = require("moment-timezone");
const QRCode = require('qrcode');
const express = require("express");
const pino = require("pino");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

const port = process.env.PORT || 3000;
let sock;
let isConnected = false;
let lastQR = null;

// ১. Gemini AI কনফিগারেশন
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// ২. বাংলা ভয়েস জেনারেটর ফাংশন (Microsoft Edge Neural Voice)
async function generateBengaliAudio(text, filename = "reminder.mp3") {
    const tts = new EdgeTTS({
        voice: "bn-BD-PradeepNeural", // মেয়ে কণ্ঠে শুনতে চাইলে 'bn-BD-NabanitaNeural' দিতে পারেন
        lang: "bn-BD",
        outputFormat: "audio-24khz-48kbitrate-mono-mp3"
    });
    const filePath = path.join(__dirname, filename);
    await tts.ttsPromise(text, filePath);
    return filePath;
}

// ৩. Gemini দিয়ে সময় ও কাজের বিবরণ বের করার ফাংশন
async function parseReminderWithAI(userText) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const now = moment().tz("Asia/Dhaka").format("YYYY-MM-DD HH:mm:ss");
        
        const prompt = `
        Current Time in Bangladesh (Asia/Dhaka): ${now}
        User Message: "${userText}"
        
        You are a smart personal reminder assistant. Extract:
        1. "isReminder": true if user is asking to be reminded or scheduled for a message/call, otherwise false.
        2. "time": Target time in ISO format (YYYY-MM-DDTHH:mm:ss+06:00).
        3. "task": The exact message/task in friendly spoken Bengali to say to the user.
        4. "reply": A short Bengali confirmation message acknowledging the reminder.

        Respond ONLY with a valid JSON object without markdown fences, e.g.:
        {"isReminder": true, "time": "2026-09-22T12:00:00+06:00", "task": "আপনার দুপুর ১২টার মিটিং শুরু করার কথা ছিল।", "reply": "ঠিক আছে! আমি কাল দুপুর ১২:০০ টায় আপনাকে মনে করিয়ে দেব।"}
        `;

        const result = await model.generateContent(prompt);
        let responseText = result.response.text().trim();
        responseText = responseText.replace(/```json|```/g, '').trim();
        return JSON.parse(responseText);
    } catch (e) {
        console.error("AI Error:", e);
        return null;
    }
}

// ৪. WhatsApp কানেকশন ফাংশন
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) lastQR = qr;

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            lastQR = null;
            console.log('✅ WhatsApp Connected & Ready!');
        }
    });

    // 📩 ইনকামিং মেসেজ প্রসেসিং
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const senderJid = msg.key.remoteJid;
            const textContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

            if (textContent) {
                console.log(`Received message: ${textContent}`);
                
                // AI দিয়ে মেসেজ বিশ্লেষণ
                const aiData = await parseReminderWithAI(textContent);

                if (aiData && aiData.isReminder && aiData.time) {
                    // সাথে সাথে কনফার্মেশন রিপ্লাই
                    await sock.sendMessage(senderJid, { text: aiData.reply });

                    const targetDate = new Date(aiData.time);
                    console.log(`Reminder scheduled for: ${targetDate}`);

                    // নির্দিষ্ট সময়ে রিমাইন্ডার শিডিউল
                    schedule.scheduleJob(targetDate, async () => {
                        let audioFile = null;
                        try {
                            // সুন্দর বাংলা ভয়েস তৈরি
                            audioFile = await generateBengaliAudio(aiData.task, `remind_${Date.now()}.mp3`);
                            
                            // WhatsApp Voice Note (PTT) হিসেবে সরাসরি পাঠানো
                            await sock.sendMessage(senderJid, {
                                audio: fs.readFileSync(audioFile),
                                mimetype: 'audio/mp4',
                                ptt: true
                            });

                            // সাথে লিখিত টেক্সট মেসেজ পাঠানো
                            await sock.sendMessage(senderJid, { text: `🔔 রিমাইন্ডার:\n${aiData.task}` });
                        } catch (err) {
                            console.error("Failed to send scheduled reminder:", err);
                        } finally {
                            // কাজ শেষে অস্থায়ী অডিও ফাইল মুছে ফেলা
                            if (audioFile && fs.existsSync(audioFile)) {
                                fs.unlinkSync(audioFile);
                            }
                        }
                    });
                }
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// কিউআর কোড পেজ
app.get('/qr', async (req, res) => {
    if (isConnected) return res.send('<h1>আপনার হোয়াটসঅ্যাপ কানেক্টেড আছে!</h1>');
    if (!lastQR) return res.send('<h1>কিউআর কোড লোড হচ্ছে, ৫ সেকেন্ড পর পেজটি রিফ্রেশ দিন...</h1>');

    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`
            <html>
                <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
                <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#f0f2f5; font-family:sans-serif;">
                    <div style="background:white; padding:30px; border-radius:15px; box-shadow:0 10px 25px rgba(0,0,0,0.1); text-align:center;">
                        <h2 style="color:#075e54;">AI WhatsApp Assistant</h2>
                        <img src="${qrImage}" style="width:260px; height:260px; border:4px solid #25d366; border-radius:10px;" />
                        <p style="margin-top:15px; color:#555;">আপনার হোয়াটসঅ্যাপের <b>Linked Devices</b> দিয়ে স্ক্যান করুন।</p>
                    </div>
                </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('QR Code error.');
    }
});

// লগআউট রুট
app.get('/logout', (req, res) => {
    if (fs.existsSync('session_auth')) {
        fs.rmSync('session_auth', { recursive: true, force: true });
        res.send('Logged Out. Restarting server...');
        process.exit(0);
    } else {
        res.send('No active session.');
    }
});

app.get('/', (req, res) => res.send(isConnected ? 'AI Bot is Online 🚀' : 'Offline. Scan /qr'));

app.listen(port, () => {
    console.log(`Server listening on ${port}`);
    connectToWhatsApp();
});
