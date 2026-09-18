const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const QRCode = require('qrcode');
const express = require("express");
const pino = require("pino");

const app = express();
const port = process.env.PORT || 3000;
let sock;
let isConnected = false;
let lastQR = null; // এখানে কিউআর কোড সেভ থাকবে

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // টার্মিনালেও দেখাবে
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            lastQR = qr; // নতুন কিউআর কোড আসলে সেটি ধরবে
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            lastQR = null;
            console.log('WhatsApp Connected!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// 🔥 কিউআর কোড দেখার ম্যাজিক লিঙ্ক
app.get('/qr', async (req, res) => {
    if (isConnected) return res.send('<h1>আপনার হোয়াটসঅ্যাপ অলরেডি কানেক্ট হয়ে গেছে!</h1>');
    if (!lastQR) return res.send('<h1>কিউআর কোড লোড হচ্ছে, ৫ সেকেন্ড পর এই পেজটি রিফ্রেশ দিন...</h1>');

    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`
            <html>
                <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#f0f2f5; font-family:sans-serif;">
                    <div style="background:white; padding:30px; border-radius:20px; box-shadow:0 10px 25px rgba(0,0,0,0.1); text-align:center;">
                        <h2 style="color:#075e54;">Elite Arena WhatsApp Login</h2>
                        <img src="${qrImage}" style="width:280px; height:280px; border:5px solid #25d366; border-radius:10px;" />
                        <p style="margin-top:20px; color:#666;">আপনার হোয়াটসঅ্যাপের <b>Linked Devices</b> দিয়ে স্ক্যান করুন।</p>
                        <p style="font-size:12px; color:red;">কোড কাজ না করলে পেজটি রিফ্রেশ দিন।</p>
                    </div>
                    <script>setTimeout(() => { location.reload(); }, 20000);</script>
                </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('QR Code জেনারেট করতে সমস্যা হয়েছে।');
    }
});

app.get('/send', async (req, res) => {
    const { number, msg } = req.query;
    if (!isConnected) return res.status(503).send('Error: WhatsApp not connected. Go to /qr');
    if (!number || !msg) return res.send('Number and Msg required!');
    try {
        await sock.sendMessage(`88${number}@s.whatsapp.net`, { text: msg });
        res.send('Success: Message Sent!');
    } catch (e) { res.send('Failed: ' + e.message); }
});

app.get('/', (req, res) => res.send(isConnected ? 'Online' : 'Offline. Go to /qr'));
app.listen(port, () => { console.log(`Running on ${port}`); connectToWhatsApp(); });
