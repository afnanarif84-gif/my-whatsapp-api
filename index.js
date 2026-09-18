const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const express = require("express");
const pino = require("pino");

const app = express();
const port = process.env.PORT || 3000;
let sock;

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
            console.log("QR জেনারেট হয়েছে, স্ক্যান করুন:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp Connected! এবার আর ক্রাশ হবে না।');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// মেসেজ পাঠানোর লিঙ্ক: /send?number=017xx&msg=Hello
app.get('/send', async (req, res) => {
    const number = req.query.number;
    const message = req.query.msg;

    if (!sock || !number || !message) return res.send('Error: number and msg required');

    try {
        const jid = `88${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.send('Sent Successful!');
    } catch (err) {
        res.send('Failed: ' + err.message);
    }
});

app.get('/', (req, res) => res.send('Bot is Running...'));
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

connectToWhatsApp();
