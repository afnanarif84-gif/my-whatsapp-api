const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require('qrcode');
const express = require("express");
const pino = require("pino");

const app = express();
const port = process.env.PORT || 3000;
let sock;
let isConnected = false;
let qrCodeData = null; // কিউআর ডাটা সেভ রাখার জন্য

async function connectToWhatsApp() {
    // সেশন সেভ করার জন্য
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }) // ফালতু লগ বন্ধ রাখবে
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr; // নতুন কিউআর কোড আসলে সেটি সেভ হবে
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('কানেকশন বন্ধ হয়েছে। পুনরায় চেষ্টা করা হচ্ছে...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            qrCodeData = null; // কানেক্ট হয়ে গেলে কিউআর ডাটা মুছে যাবে
            console.log('WhatsApp Connected! এবার মেসেজ পাঠানো যাবে।');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// হোম রুট - UptimeRobot এখানে হিট করবে
app.get('/', (req, res) => {
    if (isConnected) {
        res.send('<h1>Bot Status: Online</h1><p>WhatsApp is connected successfully.</p>');
    } else {
        res.send('<h1>Bot Status: Offline</h1><p>WhatsApp is not connected. Go to <a href="/qr">/qr</a> to scan.</p>');
    }
});

// 🔥 কিউআর কোড দেখার জন্য স্পেশাল রুট
app.get('/qr', async (req, res) => {
    if (isConnected) return res.send('<h1>Already Connected!</h1><p>Your WhatsApp is already linked.</p>');
    if (!qrCodeData) return res.send('<h1>Please Wait...</h1><p>QR code is generating, refresh after 10 seconds.</p>');

    try {
        const qrImage = await QRCode.toDataURL(qrCodeData);
        res.send(`
            <html>
                <head>
                    <title>Scan WhatsApp QR</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #f0f2f5; margin: 0; }
                        .card { background: white; padding: 20px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; }
                        img { width: 250px; height: 250px; border: 5px solid #25d366; border-radius: 10px; }
                        p { color: #666; margin-top: 15px; font-size: 14px; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>Scan with WhatsApp</h2>
                        <img src="${qrImage}" />
                        <p>This QR will refresh automatically.</p>
                    </div>
                    <script>
                        setTimeout(() => { location.reload(); }, 25000); // ২০ সেকেন্ড পর অটো রিফ্রেশ হবে
                    </script>
                </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR image');
    }
});

// মেসেজ পাঠানোর লিঙ্ক: /send?number=017xx&msg=Hello
app.get('/send', async (req, res) => {
    const number = req.query.number;
    const message = req.query.msg;

    if (!isConnected || !sock) {
        return res.status(503).send('Error: WhatsApp is not connected yet! Go to /qr to scan.');
    }

    if (!number || !message) {
        return res.status(400).send('Error: number and msg required.');
    }

    try {
        const jid = `88${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.send('Message Sent Successfully!');
    } catch (err) {
        res.status(500).send('Failed to send message: ' + err.message);
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

connectToWhatsApp();
