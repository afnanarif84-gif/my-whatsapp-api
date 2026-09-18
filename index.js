const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const express = require("express");
const pino = require("pino");

const app = express();
const port = process.env.PORT || 3000;
let sock;

async function connectToWhatsApp() {
    const { state, save閱 } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("নিচের কিউআর কোডটি স্ক্যান করুন:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp Connected Successfully!');
        }
    });

    sock.ev.on('creds.update', save閱);
}

// মেসেজ পাঠানোর এপিআই
app.get('/send', async (req, res) => {
    const number = req.query.number;
    const message = req.query.msg;

    if (!number || !message) return res.send('Error: number and msg required');

    try {
        const jid = `88${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ status: 'success', message: 'Sent!' });
    } catch (err) {
        res.json({ status: 'error', message: err.message });
    }
});

app.get('/', (req, res) => res.send('Baileys Bot is Running!'));
app.listen(port, () => console.log(`Server on port ${port}`));

connectToWhatsApp();
