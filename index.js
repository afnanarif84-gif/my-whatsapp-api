const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
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

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

// বাংলা সংখ্যাকে ইংরেজি সংখ্যায় রূপান্তর
function toEnglishDigits(str) {
    const bnDigits = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };
    return str.replace(/[০-৯]/g, char => bnDigits[char]);
}

// বাংলা ভয়েস অডিও তৈরি ফাংশন
async function generateBengaliAudio(text, filename = "reminder.mp3") {
    const tts = new EdgeTTS({
        voice: "bn-BD-PradeepNeural",
        lang: "bn-BD",
        outputFormat: "audio-24khz-48kbitrate-mono-mp3"
    });
    const filePath = path.join(__dirname, filename);
    await tts.ttsPromise(text, filePath);
    return filePath;
}

// রিমাইন্ডার প্রসেসিং (Gemini REST + Smart Fallback)
async function parseReminder(rawText) {
    const userText = toEnglishDigits(rawText);
    const now = moment().tz("Asia/Dhaka").format("YYYY-MM-DD HH:mm:ss");

    // ১. চেষ্টা করা হবে Gemini API দিয়ে বোঝার
    if (GEMINI_KEY) {
        try {
            const prompt = `Current Time in Bangladesh: ${now}\nUser Message: "${userText}"\nExtract reminder details. Reply ONLY with JSON:\n{"isReminder": true, "time": "YYYY-MM-DDTHH:mm:ss+06:00", "task": "কাজের বিবরণ বাংলায়", "reply": "কনফার্মেশন মেসেজ বাংলায়"}`;
            
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const json = await res.json();
            const textResponse = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (textResponse) {
                const cleanJson = textResponse.replace(/```json|```/g, '').trim();
                const parsed = JSON.parse(cleanJson);
                if (parsed && parsed.isReminder) return parsed;
            }
        } catch (err) {
            console.log("AI API fallback active:", err.message);
        }
    }

    // ২. স্মার্ট অফলাইন শিডিউলার (যদি API মিস করে তাও ১০০% কাজ করবে)
    const minMatch = userText.match(/(\d+)\s*(মিনিট|min|minute|মিনিটের)/i);
    const hourMatch = userText.match(/(\d+)\s*(ঘণ্টা|ঘন্টা|hour)/i);

    if (minMatch || hourMatch) {
        let addMins = 0;
        if (minMatch) addMins += parseInt(minMatch[1], 10);
        if (hourMatch) addMins += parseInt(hourMatch[1], 10) * 60;

        const targetTime = moment().tz("Asia/Dhaka").add(addMins, 'minutes').format();
        const cleanTask = rawText
            .replace(/আমাকে/g, '')
            .replace(/এখন থেকে/g, '')
            .replace(/মনে করিয়ে দাও|মনে করিয়ে দিও|কল দিয়ে বলো|বলবা/gi, '')
            .replace(/[০-৯\d]+\s*(মিনিট|মিনিটের|ঘণ্টা|ঘন্টা|পরে|পর)/gi, '')
            .trim();

        return {
            isReminder: true,
            time: targetTime,
            task: cleanTask.length > 2 ? `আপনার কাজ: ${cleanTask}` : rawText,
            reply: `ঠিক আছে! আমি ঠিক ${minMatch ? minMatch[1] : (hourMatch ? hourMatch[1] : '')} ${minMatch ? 'মিনিট' : 'ঘণ্টা'} পর আপনাকে ভয়েস মেসেজ পাঠিয়ে মনে করিয়ে দেব।`
        };
    }

    return null;
}

// WhatsApp কানেকশন
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');

    sock = makeWASocket({
        auth: state,
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

    // মেসেজ রিসিভ ও হ্যান্ডলিং
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const senderJid = msg.key.remoteJid;
            const textContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

            if (textContent) {
                console.log(`📩 New message: ${textContent}`);

                const reminderData = await parseReminder(textContent);

                if (reminderData && reminderData.isReminder && reminderData.time) {
                    // সাথে সাথে কনফার্মেশন রিপ্লাই পাঠানো
                    await sock.sendMessage(senderJid, { text: reminderData.reply });
                    console.log(`✅ Confirmation sent! Scheduled for: ${reminderData.time}`);

                    const targetDate = new Date(reminderData.time);

                    // নির্দিষ্ট সময়ে ভয়েস রিমাইন্ডার ট্রিগার
                    schedule.scheduleJob(targetDate, async () => {
                        let audioFile = null;
                        try {
                            console.log(`⏰ Triggering voice reminder...`);
                            audioFile = await generateBengaliAudio(reminderData.task, `remind_${Date.now()}.mp3`);

                            // ভয়েস নোট পাঠানো
                            await sock.sendMessage(senderJid, {
                                audio: fs.readFileSync(audioFile),
                                mimetype: 'audio/mp4',
                                ptt: true
                            });

                            // টেক্সট পাঠানো
                            await sock.sendMessage(senderJid, { text: `🔔 রিমাইন্ডার:\n${reminderData.task}` });
                            console.log(`🎉 Reminder delivered successfully!`);
                        } catch (err) {
                            console.error("Failed to send reminder:", err);
                        } finally {
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

// কিউআর কোড রুট
app.get('/qr', async (req, res) => {
    if (isConnected) return res.send('<h1>আপনার হোয়াটসঅ্যাপ কানেক্টেড আছে!</h1>');
    if (!lastQR) return res.send('<h1>কিউআর কোড আসছে, রিফ্রেশ দিন...</h1>');

    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f2f5;font-family:sans-serif;"><div style="background:white;padding:30px;border-radius:15px;text-align:center;"><h2>AI WhatsApp Assistant</h2><img src="${qrImage}" style="width:260px;height:260px;"/><p>Linked Devices দিয়ে স্ক্যান করুন</p></div></body></html>`);
    } catch (err) {
        res.status(500).send('QR Error');
    }
});

// লগআউট
app.get('/logout', (req, res) => {
    if (fs.existsSync('session_auth')) {
        fs.rmSync('session_auth', { recursive: true, force: true });
        res.send('Logged Out. Server restarting...');
        process.exit(0);
    } else {
        res.send('No active session.');
    }
});

app.get('/', (req, res) => res.send(isConnected ? 'AI Bot Online 🚀' : 'Offline. Scan /qr'));

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    connectToWhatsApp();
});
