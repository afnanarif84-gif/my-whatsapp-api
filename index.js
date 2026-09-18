const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');
const express = require("express");
const pino = require("pino");
const cors = require("cors");
const fs = require("fs"); // ফাইল সিস্টেম ইমপোর্ট করা হয়েছে

const app = express();
app.use(cors());

const port = process.env.PORT || 3000;
let sock;
let isConnected = false;
let lastQR = null;
let incomingMessages = []; // ইনকামিং মেসেজ সেভ করার জন্য অ্যারে

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            lastQR = qr;
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            lastQR = null;
            console.log('WhatsApp Connected!');
        }
    });

    // 📩 ইনকামিং মেসেজ ধরার জন্য লিসেনার
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const senderNumber = msg.key.remoteJid.replace('@s.whatsapp.net', '');
            const textContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            
            if (textContent) {
                // নতুন মেসেজটি তালিকার প্রথমে যোগ করা হচ্ছে
                incomingMessages.unshift({
                    sender: senderNumber,
                    message: textContent,
                    time: new Date().toLocaleTimeString()
                });

                // স্মৃতি বাঁচাতে শুধু লেটেস্ট ৫০টি মেসেজ রাখা হচ্ছে
                if (incomingMessages.length > 50) incomingMessages.pop();
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ১. 🛑 লগআউট বা সেশন রিসেট লিঙ্ক
app.get('/logout', (req, res) => {
    try {
        if (fs.existsSync('session_auth')) {
            fs.rmSync('session_auth', { recursive: true, force: true });
            res.send('<h1>Logged Out!</h1><p>আপনার সেশন মুছে ফেলা হয়েছে। নতুন কিউআর কোড পেতে রেন্ডার থেকে Restart দিন অথবা ২ মিনিট পর /qr পেজটি দেখুন।</p>');
            process.exit(0); // সার্ভার রিস্টার্ট করবে রেন্ডার অটোমেটিক
        } else {
            res.send('No active session found.');
        }
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

// ২. 📥 ইনকামিং মেসেজ দেখার লিঙ্ক
app.get('/messages', (req, res) => {
    res.json(incomingMessages);
});

// ৩. 🖼️ কিউআর কোড দেখার লিঙ্ক
app.get('/qr', async (req, res) => {
    if (isConnected) return res.send('<h1>আপনার হোয়াটসঅ্যাপ অলরেডি কানেক্ট হয়ে গেছে!</h1>');
    if (!lastQR) return res.send('<h1>কিউআর কোড লোড হচ্ছে, ৫ সেকেন্ড পর এই পেজটি রিফ্রেশ দিন...</h1>');

    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`
            <html>
                <head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
                <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#f0f2f5; font-family:sans-serif;">
                    <div style="background:white; padding:30px; border-radius:20px; box-shadow:0 10px 25px rgba(0,0,0,0.1); text-align:center;">
                        <h2 style="color:#075e54;">Elite Arena WhatsApp Login</h2>
                        <img src="${qrImage}" style="width:280px; height:280px; border:5px solid #25d366; border-radius:10px;" />
                        <p style="margin-top:20px; color:#666;">আপনার হোয়াটসঅ্যাপের <b>Linked Devices</b> দিয়ে স্ক্যান করুন।</p>
                    </div>
                    <script>setTimeout(() => { location.reload(); }, 20000);</script>
                </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('QR Code error.');
    }
});

// ৪. 📤 মেসেজ পাঠানোর লিঙ্ক
app.get('/send', async (req, res) => {
    const { number, msg } = req.query;
    if (!isConnected) return res.status(503).send('Error: WhatsApp not connected.');
    if (!number || !msg) return res.status(400).send('Number and Msg required!');
    
    try {
        const jid = `88${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: msg });
        res.send('Success');
    } catch (e) { 
        res.status(500).send('Failed: ' + e.message); 
    }
});

app.get('/', (req, res) => res.send(isConnected ? 'Online' : 'Offline. Go to /qr'));

app.listen(port, () => { 
    console.log(`Running on ${port}`); 
    connectToWhatsApp(); 
});
