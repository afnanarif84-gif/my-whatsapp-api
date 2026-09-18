const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const express = require("express");
const pino = require("pino");

const app = express();
const port = process.env.PORT || 3000;
let sock;
let isConnected = false; // কানেকশন চেক করার ভ্যারিয়েবল

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
            isConnected = false;
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('কানেকশন বন্ধ হয়েছে। পুনরায় চেষ্টা করা হচ্ছে...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            console.log('WhatsApp Connected! এবার মেসেজ পাঠানো যাবে।');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// হোম রুট - UptimeRobot এখানে হিট করবে
app.get('/', (req, res) => {
    res.send(isConnected ? 'Bot is Online and Connected!' : 'Bot is Online, but waiting for WhatsApp Connection...');
});

// মেসেজ পাঠানোর লিঙ্ক: /send?number=017xx&msg=Hello
app.get('/send', async (req, res) => {
    const number = req.query.number;
    const message = req.query.msg;

    // ১. হোয়াটসঅ্যাপ কানেক্টেড কি না চেক
    if (!isConnected || !sock) {
        return res.status(503).send('Error: WhatsApp is not connected yet! Please wait or scan QR.');
    }

    // ২. প্যারামিটার চেক
    if (!number || !message) {
        return res.status(400).send('Error: number and msg required in URL query.');
    }

    try {
        // নম্বর ফরম্যাট ঠিক করা
        const jid = `88${number}@s.whatsapp.net`;
        
        await sock.sendMessage(jid, { text: message });
        res.send('Message Sent Successfully!');
    } catch (err) {
        console.log('মেসেজ পাঠাতে সমস্যা হয়েছে:', err.message);
        res.status(500).send('Failed to send message: ' + err.message);
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

connectToWhatsApp();
